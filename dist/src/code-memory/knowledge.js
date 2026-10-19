import { sourceSlice, words } from "./vector.js";
const cache = new WeakMap();
export function knowledge(index) {
    const previous = cache.get(index);
    if (previous)
        return previous;
    const roots = index.units.filter(unit => unit.kind === "function" || unit.kind === "method" || unit.kind === "type");
    const rootIds = new Set(roots.map(unit => unit.id));
    const units = new Map(index.units.map(unit => [unit.id, unit])), symbols = new Map(index.symbols.map(symbol => [symbol.id, symbol]));
    const names = new Map(), vocabulary = new Map(), frequency = new Map();
    for (const unit of roots) {
        names.set(unit.name, [...names.get(unit.name) ?? [], unit]);
        const terms = new Set(words(unit.name + " " + unit.path + " " + sourceSlice(index, unit)));
        vocabulary.set(unit.id, terms);
        for (const term of terms)
            frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
    const symbolOwners = new Map();
    const owner = (id) => {
        let unit = units.get(id);
        if (!unit) {
            if (symbolOwners.has(id))
                return symbolOwners.get(id);
            const symbol = symbols.get(id);
            if (!symbol)
                return;
            unit = (names.get(symbol.name) ?? []).filter(candidate => candidate.path === symbol.path && candidate.span.start_byte >= symbol.declaration_span.start_byte && candidate.span.end_byte <= symbol.declaration_span.end_byte)
                .sort((a, b) => (a.span.end_byte - a.span.start_byte) - (b.span.end_byte - b.span.start_byte))[0] ?? units.get(symbol.owner_unit_id);
            while (unit && !rootIds.has(unit.id))
                unit = units.get(unit.parent_id ?? "");
            symbolOwners.set(id, unit);
            return unit;
        }
        while (unit && unit.kind !== "function" && unit.kind !== "method" && unit.kind !== "type")
            unit = units.get(unit.parent_id ?? "");
        return unit;
    };
    const outgoing = new Map(), incoming = new Map();
    for (const relation of index.relations) {
        if (relation.predicate !== "calls")
            continue;
        const from = owner(relation.from_id), to = owner(relation.to_id);
        if (!from || !to || from.id === to.id)
            continue;
        if (!outgoing.has(from.id))
            outgoing.set(from.id, new Set());
        outgoing.get(from.id).add(to.id);
        if (!incoming.has(to.id))
            incoming.set(to.id, new Set());
        incoming.get(to.id).add(from.id);
    }
    const value = { roots, units, symbols, names, outgoing, incoming, vocabulary, frequency, owner };
    cache.set(index, value);
    return value;
}
