import { bounded } from "./query.js";
import { CMError } from "./source.js";
import { LocalVectors, sourceSlice, words } from "./vector.js";
import { knowledge } from "./knowledge.js";
import { focusQuery } from "./focus.js";
const STOP = new Set(words("the and for from with that this code function project preserve unrelated behavior interfaces repair apply restore correctly existing when into must return locate supplied source available checks results"));
const WHOLE_FILE_BYTES = 3000, MAX_CALLERS = 6, MAX_USERS = 3, USER_MIN_SCORE = 0.35, RARE_NAME_UNITS = 2;
const RENAME = /\brenam(?:e|es|ed|ing)\b/i;
const BREADTH = /\b(?:everywhere|wherever|throughout|across|every (?:import|call|caller|use|usage|place)s?|all (?:callers|uses|usages|importers|call sites|places))\b/i;
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export async function retrieveGraph(index, vectors, query, maxBytes = 6000, signal, policy = "adaptive", detail = "focused") {
    if (!query.trim() || query.length > 16000)
        throw new CMError("invalid_argument", "query must contain 1..16000 characters");
    query = focusQuery(query);
    // A change across uses needs the users and what they call; such requests get half again the budget.
    const breadth = BREADTH.test(query), budget = Math.min(32000, Math.round(bounded(maxBytes, 6000, 32000, "max_bytes") * (breadth ? 1.5 : 1))), kb = knowledge(index);
    const pathHints = [...query.matchAll(/[\w./-]+\.(?:[cm]?[jt]sx?)/g)].map(match => match[0]);
    const matchesPath = (unit) => pathHints.some(path => unit.path === path || unit.path.endsWith("/" + path));
    const names = new Set([...query.matchAll(/`([\w$]+)`/g)].map(match => match[1]));
    // Outside a named file only identifier-shaped names count: a minified `A` or a plain `Find` also reads as an English word.
    const identifier = (name) => name.length >= 3 && /[a-z][A-Z]|[A-Z]{2}|[_$]/.test(name);
    for (const unit of kb.roots)
        if ((matchesPath(unit) || identifier(unit.name)) && new RegExp("(?:^|[^\\w$])" + escaped(unit.name) + "(?:$|[^\\w$])").test(query))
            names.add(unit.name);
    if (/^[\w$]+$/.test(query.trim()))
        names.add(query.trim());
    const named = kb.roots.filter(unit => names.has(unit.name) && (!pathHints.length || matchesPath(unit)));
    const terms = [...new Set(words(query).filter(term => term.length > 2 && !STOP.has(term)))];
    const lexical = kb.roots.map(unit => ({ unit, score: terms.reduce((total, term) => total + (kb.vocabulary.get(unit.id).has(term) ? Math.log(1 + kb.roots.length / (1 + (kb.frequency.get(term) ?? 0))) * (words(unit.name).includes(term) ? 3 : 1) : 0), 0)
            * (/\/(?:vendor|generated)\//.test(unit.path) && !matchesPath(unit) ? .35 : 1) / Math.pow(Math.max(1, sourceSlice(index, unit).length / 1000), .2) }))
        .filter(item => item.score > 0 && (!pathHints.length || matchesPath(item.unit))).sort((a, b) => b.score - a.score);
    const combined = new Map();
    for (const [rank, item] of lexical.slice(0, 32).entries())
        combined.set(item.unit.id, 2 / (10 + rank));
    const exact = named.length > 0;
    const useDense = policy === "graph" || !exact;
    if (useDense) {
        for (const [rank, item] of (await vectors.search(index, query, 24, signal)).entries()) {
            const chunk = vectors.chunks(index).find(chunk => chunk.id === item.id);
            const unit = kb.owner(chunk.owner_unit_id) ?? kb.owner(chunk.id);
            if (!unit || pathHints.length && !matchesPath(unit))
                continue;
            combined.set(unit.id, (combined.get(unit.id) ?? 0) + 1 / (10 + rank));
        }
    }
    for (const unit of named)
        combined.set(unit.id, (combined.get(unit.id) ?? 0) + 2);
    const seedScores = new Map(combined);
    for (const [id, score] of seedScores) {
        const neighbors = new Set([...kb.outgoing.get(id) ?? [], ...kb.incoming.get(id) ?? []]);
        const support = [...neighbors].reduce((best, neighbor) => Math.max(best, seedScores.get(neighbor) ?? 0), 0);
        combined.set(id, score + Math.min(.08, support * .12));
    }
    const ranked = [...combined].sort((a, b) => b[1] - a[1]);
    const selected = ranked.filter(([, score]) => score >= (ranked[0]?.[1] ?? 0) * .82).slice(0, detail === "expanded" ? 4 : 2).map(([id]) => kb.units.get(id));
    // A query word that names only one or two functions in the project ("caret" in replaceCaret) points at them more
    // directly than shared vocabulary does; on discovery such a function in a file already found joins the roots when the
    // ranking passed it over (the file was right, the function was not) and no chosen root is named after the request.
    if (!exact && selected.length < (detail === "expanded" ? 4 : 3) && !selected.some(root => words(root.name).some(word => terms.includes(word)))) {
        const naming = new Map();
        for (const unit of kb.roots)
            if (!unit.name.startsWith("anonymous@"))
                for (const word of new Set(words(unit.name)))
                    if (terms.includes(word))
                        naming.set(word, [...naming.get(word) ?? [], unit]);
        const named = [...naming.values()].filter(units => units.length <= RARE_NAME_UNITS).flat().filter(unit => !selected.includes(unit) && selected.some(root => root.path === unit.path) && (combined.get(unit.id) ?? 0) > 0)
            .sort((a, b) => (combined.get(b.id) ?? 0) - (combined.get(a.id) ?? 0));
        if (named[0])
            selected.push(named[0]);
    }
    const parts = [], shown = new Set(), missing = new Set();
    let bytes = 0, omissions = 0;
    const add = (path, span, reason) => {
        const file = index.files.find(file => file.path === path), raw = Buffer.from(file.source, "utf8");
        let ranges = [[span.start_byte, span.end_byte]];
        for (const part of parts.filter(part => part.path === path))
            ranges = ranges.flatMap(([start, end]) => part.span.end_byte <= start || part.span.start_byte >= end ? [[start, end]] :
                [[start, Math.min(end, part.span.start_byte)], [Math.max(start, part.span.end_byte), end]].filter(([a, b]) => b > a));
        const length = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
        if (bytes + length > budget)
            return false;
        for (const [start, end] of ranges)
            parts.push({ path, reason, span: { ...span, start_byte: start, end_byte: end, line_start: raw.subarray(0, start).toString("utf8").split("\n").length,
                    line_end: raw.subarray(0, Math.max(start, end - 1)).toString("utf8").split("\n").length }, text: raw.subarray(start, end).toString("utf8") });
        bytes += length;
        return true;
    };
    const prefix = (path, span) => {
        const raw = Buffer.from(index.files.find(file => file.path === path).source, "utf8");
        const newline = raw.indexOf(10, span.start_byte);
        let end = Math.min(span.end_byte, span.start_byte + 180, newline < 0 ? span.end_byte : newline + 1);
        while (end < raw.length && (raw[end] & 0xc0) === 0x80)
            end--;
        return { ...span, end_byte: end };
    };
    for (const unit of selected)
        if (!add(unit.path, unit.span, "match")) {
            omissions++;
            add(unit.path, prefix(unit.path, unit.span), "signature");
        }
    // Files of the matches first: the dependency closure must not spend the budget a short matched module needs,
    // and a second place to change often sits next to the first.
    for (const path of [...new Set(selected.map(unit => unit.path))])
        promote(path);
    const queue = selected.map(unit => ({ unit, depth: 0 })), visited = new Set();
    for (let cursor = 0; cursor < queue.length && visited.size < (detail === "expanded" ? 24 : 12); cursor++) {
        const { unit, depth } = queue[cursor];
        if (visited.has(unit.id))
            continue;
        visited.add(unit.id);
        for (const id of unit.required_symbol_ids) {
            if (shown.has(id) || missing.has(id))
                continue;
            const symbol = kb.symbols.get(id);
            const covered = parts.some(part => part.path === symbol.path && part.span.start_byte <= symbol.declaration_span.start_byte && part.span.end_byte >= symbol.declaration_span.end_byte);
            const size = symbol.declaration_span.end_byte - symbol.declaration_span.start_byte;
            if (covered || ((detail === "expanded" || size <= 1200) && add(symbol.path, symbol.declaration_span, "dependency"))) {
                shown.add(id);
                const target = kb.owner(id);
                if (target && depth < (detail === "expanded" ? 2 : 1))
                    queue.push({ unit: target, depth: depth + 1 });
            }
            else {
                missing.add(id);
                omissions++;
                add(symbol.path, prefix(symbol.path, symbol.declaration_span), "signature");
            }
        }
    }
    // A fragment of a short module invites a confirming read of the whole file; show such files whole while the budget allows.
    function promote(path) {
        const raw = Buffer.from(index.files.find(file => file.path === path).source, "utf8"), current = parts.filter(part => part.path === path);
        const shownBytes = current.reduce((sum, part) => sum + part.span.end_byte - part.span.start_byte, 0);
        if (raw.length > WHOLE_FILE_BYTES || shownBytes === raw.length || bytes - shownBytes + raw.length > budget)
            return;
        const whole = { path, whole: true, reason: current.some(part => part.reason === "match") ? "match" : "dependency", text: raw.toString("utf8"),
            span: { ...current[0].span, start_byte: 0, end_byte: raw.length, line_start: 1, line_end: raw.subarray(0, Math.max(0, raw.length - 1)).toString("utf8").split("\n").length } };
        parts.splice(parts.indexOf(current[0]), 1, whole);
        for (const part of current.slice(1))
            parts.splice(parts.indexOf(part), 1);
        bytes += raw.length - shownBytes;
        for (const id of [...missing])
            if (kb.symbols.get(id).path === path) {
                missing.delete(id);
                shown.add(id);
                omissions--;
            }
    }
    // A change to a module's contract usually continues in the modules that use it. When the matched modules are shown whole,
    // the remaining budget goes to their users elsewhere that the query's words also point to, best lexical match first.
    const lexicalScore = new Map(lexical.map(item => [item.unit.id, item.score])), topLexical = lexical[0]?.score ?? 0;
    const matchedFiles = new Set(selected.map(unit => unit.path).filter(path => parts.some(part => part.path === path && part.whole)));
    // Only for requests that ask for the change across uses; a fix in one place would just pay for extra context in every call.
    if (matchedFiles.size && topLexical > 0 && breadth) {
        const exported = new Set(index.symbols.filter(symbol => matchedFiles.has(symbol.path)).map(symbol => symbol.id));
        const users = new Set();
        for (const relation of index.relations) {
            if ((relation.predicate !== "references" && relation.predicate !== "calls") || !exported.has(relation.to_id))
                continue;
            const user = kb.owner(relation.from_id);
            if (user && !matchedFiles.has(user.path))
                users.add(user.id);
        }
        const ranked = [...users].map(id => ({ unit: kb.units.get(id), score: lexicalScore.get(id) ?? 0 })).filter(item => item.score >= topLexical * USER_MIN_SCORE)
            .sort((a, b) => b.score - a.score).slice(0, MAX_USERS);
        for (const { unit } of ranked) {
            if (parts.some(part => part.path === unit.path && part.span.start_byte <= unit.span.start_byte && part.span.end_byte >= unit.span.end_byte) || !add(unit.path, unit.span, "dependency"))
                continue;
            // What a user calls is where its part of the change continues (a normalizer, a validator).
            for (const id of unit.required_symbol_ids) {
                const symbol = kb.symbols.get(id);
                if (!symbol || shown.has(id) || symbol.declaration_span.end_byte - symbol.declaration_span.start_byte > 1200)
                    continue;
                const target = kb.owner(id);
                if (!target || matchedFiles.has(target.path))
                    continue;
                if (parts.some(part => part.path === symbol.path && part.span.start_byte <= symbol.declaration_span.start_byte && part.span.end_byte >= symbol.declaration_span.end_byte) || add(symbol.path, symbol.declaration_span, "dependency"))
                    shown.add(id);
            }
        }
    }
    for (const path of [...new Set(parts.map(part => part.path))])
        promote(path);
    // Agents grep for call sites right after reading a definition; the compiler graph already knows them.
    // Raw call relations keep module-level call sites that the function-level graph drops.
    const callers = selected.filter(unit => !unit.name.startsWith("anonymous@")).map(unit => {
        const targets = new Set([unit.id, ...index.symbols.filter(symbol => symbol.path === unit.path && symbol.name === unit.name).map(symbol => symbol.id)]), sites = new Map();
        for (const relation of index.relations) {
            if (relation.predicate !== "calls" || !targets.has(relation.to_id))
                continue;
            const path = kb.units.get(relation.from_id)?.path ?? kb.symbols.get(relation.from_id)?.path;
            if (!path)
                continue;
            const where = `${path}:${relation.evidence.line_start}`, named = kb.owner(relation.from_id);
            sites.set(where, named && !named.name.startsWith("anonymous@") && named.id !== unit.id ? `${named.name} (${where})` : where);
        }
        const listed = [...sites].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).map(([, text]) => text);
        return `Call sites of ${unit.name}: ${listed.length ? listed.slice(0, MAX_CALLERS).join(", ") + (listed.length > MAX_CALLERS ? `, +${listed.length - MAX_CALLERS} more` : "") : "none in indexed source"}.`;
    });
    // A rename has to touch imports as well as calls, which call sites omit; agents searched for every occurrence. The index
    // knows each binding of the name (definition, import) and each call or reference to it.
    const occurrences = RENAME.test(query) ? selected.filter(unit => !unit.name.startsWith("anonymous@")).map(unit => {
        const bindings = index.symbols.filter(symbol => symbol.name === unit.name && (symbol.path === unit.path || index.relations.some(relation => relation.to_id === symbol.id) || symbol.kind === "variable"));
        const ids = new Set([unit.id, ...bindings.map(symbol => symbol.id)]), sites = new Set();
        for (const symbol of bindings)
            sites.add(`${symbol.path}:${symbol.declaration_span.line_start}`);
        for (const relation of index.relations) {
            if ((relation.predicate !== "calls" && relation.predicate !== "references") || !ids.has(relation.to_id))
                continue;
            const path = kb.units.get(relation.from_id)?.path ?? kb.symbols.get(relation.from_id)?.path;
            if (path)
                sites.add(`${path}:${relation.evidence.line_start}`);
        }
        const listed = [...sites].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
        return `Every code occurrence of ${unit.name} in the indexed source: ${listed.join(", ")}; comments and strings are not indexed.`;
    }) : [];
    signal?.throwIfAborted();
    const unvisited = new Set(queue.filter(item => !visited.has(item.unit.id)).map(item => item.unit.id)).size;
    omissions += unvisited;
    return { snapshot_id: index.snapshot_id, channels: ["compiler-knowledge", exact ? "named-anchor" : "lexical-idf", ...(useDense ? ["local-dense-vector"] : []), "bounded-dependency-closure"], bytes_used: bytes, parts, omissions, complete: false,
        retrieval: { policy, route: exact ? "named" : "discovery", detail, roots: selected.length, graph_nodes: visited.size, bindings_shown: shown.size, bindings_omitted: missing.size, dense_search: useDense },
        notes: [...callers, ...occurrences, ...(missing.size ? ["Some bindings have only source prefixes; expand context or read their declarations when their values matter."] : []), ...(unvisited ? ["Dependency traversal stopped at its node budget; transitive completeness is not established."] : [])] };
}
