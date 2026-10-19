import { CMError } from "./source.js";
import { PREDICATES } from "./types.js";
export function bounded(value, fallback, maximum, name) {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < 1 || result > maximum)
        throw new CMError("invalid_argument", `${name} must be 1..${maximum}`);
    return result;
}
function queryText(query) {
    const value = query.trim();
    if (!value || value.length > 256)
        throw new CMError("invalid_argument", "query must contain 1..256 characters");
    return value;
}
function header(index) {
    return { memory: "CM — Code Memory", snapshot_id: index.snapshot_id, capabilities: index.capabilities,
        diagnostics_count: index.diagnostics.length, limits: index.limits };
}
export function symbolSearch(index, query, limit) {
    const text = queryText(query);
    const matches = index.symbols.map((symbol) => ({ symbol, score: symbol.name === text ? 100 :
            symbol.name.toLowerCase() === text.toLowerCase() ? 80 : symbol.qualified_name.toLowerCase().includes(text.toLowerCase()) ? 40 : 0 }))
        .filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.symbol.qualified_name.localeCompare(right.symbol.qualified_name));
    return { ...header(index), total: matches.length, truncated: matches.length > (limit ?? 10),
        matches: matches.slice(0, bounded(limit, 10, 50, "limit")).map(({ symbol, score }) => ({ ...symbol, score })) };
}
function slice(index, path, span) {
    const file = index.files.find((item) => item.path === path);
    return Buffer.from(file.source, "utf8").subarray(span.start_byte, span.end_byte).toString("utf8");
}
export function codeSearch(index, query, limit) {
    const text = queryText(query);
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = index.units.filter((unit) => unit.kind !== "file" && unit.kind !== "block").map((unit) => {
        const code = slice(index, unit.path, unit.span).toLowerCase();
        const score = (unit.name === text ? 100 : 0) + tokens.reduce((total, token) => total + (code.includes(token) ? 10 : 0), 0);
        return { unit, score };
    }).filter((item) => item.score >= tokens.length * 10).sort((left, right) => right.score - left.score ||
        (left.unit.span.end_byte - left.unit.span.start_byte) - (right.unit.span.end_byte - right.unit.span.start_byte));
    const cap = bounded(limit, 10, 50, "limit");
    return { ...header(index), channels: ["exact-name", "lexical-source"], total: matches.length, truncated: matches.length > cap,
        matches: matches.slice(0, cap).map(({ unit, score }) => ({ ...unit, score, preview: slice(index, unit.path, unit.span).slice(0, 400) })) };
}
export function contextGet(index, id, maxBytes) {
    const cap = bounded(maxBytes, 16384, 65536, "max_bytes");
    const units = new Map(index.units.map((unit) => [unit.id, unit]));
    const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
    const anchor = units.get(id);
    const symbol = symbols.get(id);
    if (!anchor && !symbol)
        throw new CMError("unknown_node", id);
    const candidates = [];
    const owner = anchor ?? units.get(symbol.owner_unit_id);
    if (anchor)
        candidates.push({ id: anchor.id, path: anchor.path, span: anchor.span, reason: "anchor" });
    else
        candidates.push({ id: symbol.id, path: symbol.path, span: symbol.declaration_span, reason: "symbol_declaration" });
    const required = new Set(owner.required_symbol_ids);
    let parent = units.get(owner.parent_id ?? "");
    while (parent && parent.kind !== "file") {
        candidates.push({ id: parent.id, path: parent.path, span: parent.span, reason: "lexical_parent" });
        for (const dependency of parent.required_symbol_ids)
            required.add(dependency);
        parent = units.get(parent.parent_id ?? "");
    }
    for (const dependency of required) {
        const target = symbols.get(dependency);
        candidates.push({ id: target.id, path: target.path, span: target.declaration_span, reason: "required_symbol" });
    }
    const chosen = [];
    const omissions = [];
    let bytes = 0;
    for (const candidate of candidates) {
        if (chosen.some((item) => item.path === candidate.path && item.span.start_byte <= candidate.span.start_byte && item.span.end_byte >= candidate.span.end_byte))
            continue;
        const replaced = chosen.filter((item) => item.path === candidate.path && item.span.start_byte >= candidate.span.start_byte && item.span.end_byte <= candidate.span.end_byte);
        const added = candidate.span.end_byte - candidate.span.start_byte;
        const freed = replaced.reduce((total, item) => total + item.span.end_byte - item.span.start_byte, 0);
        if (bytes + added - freed > cap) {
            omissions.push({ id: candidate.id, reason: "byte_budget_insufficient" });
            continue;
        }
        for (const item of replaced)
            chosen.splice(chosen.indexOf(item), 1);
        chosen.push(candidate);
        bytes += added - freed;
    }
    return { ...header(index), requested_id: id, max_bytes: cap, bytes_used: bytes, completeness: "partial",
        items: chosen.map((item) => ({ ...item, text: slice(index, item.path, item.span) })), omissions,
        diagnostics: ["Byte budget; tokenizer is not configured", "Lexical context only; full dataflow completeness is not asserted"] };
}
export function graphExpand(index, id, depth, maxNodes, predicate) {
    const levels = bounded(depth, 1, 3, "depth");
    const cap = bounded(maxNodes, 30, 100, "max_nodes");
    if (predicate !== undefined && !PREDICATES.some((item) => item === predicate))
        throw new CMError("invalid_argument", "Unknown predicate");
    const nodes = new Map([...index.units, ...index.symbols].map((node) => [node.id, node]));
    if (!nodes.has(id))
        throw new CMError("unknown_node", id);
    const visited = new Set([id]);
    const edges = new Map();
    let frontier = [id];
    let truncated = false;
    for (let level = 0; level < levels && frontier.length; level++) {
        const next = [];
        for (const anchor of frontier) {
            for (const relation of index.relations) {
                if (relation.from_id !== anchor && relation.to_id !== anchor || predicate !== undefined && relation.predicate !== predicate)
                    continue;
                const neighbor = relation.from_id === anchor ? relation.to_id : relation.from_id;
                if (!visited.has(neighbor)) {
                    if (visited.size >= cap) {
                        truncated = true;
                        continue;
                    }
                    visited.add(neighbor);
                    next.push(neighbor);
                }
                if (edges.size >= 200) {
                    truncated = true;
                    continue;
                }
                edges.set(relation.id, relation);
            }
        }
        frontier = next;
    }
    return { ...header(index), anchor_id: id, direction: "both", depth: levels, truncated,
        nodes: [...visited].map((node) => nodes.get(node)), edges: [...edges.values()] };
}
