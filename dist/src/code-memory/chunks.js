import { ts } from "./ts.js";
import { byteOffsets, CMError, hash } from "./source.js";
export const CHUNKING_STRATEGIES = ["unit", "window", "ast"];
export function chunkingPolicy(strategy = "unit") {
    if (!CHUNKING_STRATEGIES.includes(strategy))
        throw new CMError("invalid_argument", "Unknown CM chunking strategy");
    return { format: "cm-chunks-1", strategy, target_bytes: 768, overlap_bytes: 128 };
}
export function projectChunks(index, strategy = "unit") {
    const policy = chunkingPolicy(strategy);
    const units = new Map(index.units.map(unit => [unit.id, unit]));
    const symbols = new Map(index.symbols.map(symbol => [symbol.id, symbol]));
    const files = new Map(index.files.map(file => [file.path, file]));
    const byFile = new Map();
    for (const unit of index.units) {
        const list = byFile.get(unit.path) ?? [];
        list.push(unit);
        byFile.set(unit.path, list);
    }
    const references = new Map();
    if (strategy !== "unit")
        for (const edge of index.relations) {
            if (edge.predicate !== "calls" && edge.predicate !== "references")
                continue;
            const target = symbols.get(edge.to_id);
            const path = units.get(edge.from_id)?.path ?? symbols.get(edge.from_id)?.path;
            if (!target || !path)
                continue;
            const list = references.get(path) ?? [];
            list.push({ start: edge.evidence.start_byte, end: edge.evidence.end_byte, symbol: target.id });
            references.set(path, list);
        }
    for (const list of references.values())
        list.sort((a, b) => a.start - b.start);
    const signatures = new Map();
    const raw = new Map(index.files.map(file => [file.path, Buffer.from(file.source, "utf8")]));
    const lineStarts = new Map([...raw].map(([path, data]) => {
        const starts = [0];
        for (let i = 0; i < data.length; i++)
            if (data[i] === 10)
                starts.push(i + 1);
        return [path, starts];
    }));
    const lineAt = (path, byte) => {
        const starts = lineStarts.get(path);
        let lo = 0, hi = starts.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (starts[mid] <= byte)
                lo = mid + 1;
            else
                hi = mid;
        }
        return lo;
    };
    const span = (path, start, end) => ({
        file_version_id: "blob:" + files.get(path).sha256, start_byte: start, end_byte: end,
        line_start: lineAt(path, start),
        line_end: lineAt(path, Math.max(start, end - 1)),
    });
    if (strategy !== "unit")
        for (const file of index.files) {
            const offsets = byteOffsets(file.source);
            const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.ES2022, true);
            const byRange = new Map((byFile.get(file.path) ?? []).map(unit => [`${unit.span.start_byte}:${unit.span.end_byte}`, unit]));
            const visit = (node) => {
                if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
                    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
                    const unit = byRange.get(`${offsets[node.getStart(source)]}:${offsets[node.end]}`);
                    if (unit && node.body && ts.isBlock(node.body))
                        signatures.set(unit.id, span(file.path, unit.span.start_byte, offsets[node.body.getStart(source) + 1]));
                }
                ts.forEachChild(node, visit);
            };
            visit(source);
        }
    const dependencies = (path, range) => {
        const list = references.get(path) ?? [];
        let lo = 0, hi = list.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (list[mid].start < range.start_byte)
                lo = mid + 1;
            else
                hi = mid;
        }
        const ids = new Set();
        for (let i = lo; i < list.length && list[i].start < range.end_byte; i++) {
            const item = list[i], symbol = symbols.get(item.symbol);
            if (item.end <= range.end_byte && (symbol.path !== path || symbol.declaration_span.start_byte < range.start_byte || symbol.declaration_span.end_byte > range.end_byte))
                ids.add(symbol.id);
        }
        return [...ids].sort();
    };
    const chunk = (owner, range, name, id = "chunk:" + hash(JSON.stringify([policy, owner.path, range.start_byte, range.end_byte])).slice(0, 32)) => ({
        ...owner, id, name, span: range, kind: "block", parent_id: owner.id,
        owner_unit_id: owner.id, symbol_names: [owner.name], signatures: signatures.has(owner.id) ? [signatures.get(owner.id)] : [],
        required_symbol_ids: dependencies(owner.path, range),
    });
    const windows = (owner, range) => {
        const data = raw.get(owner.path), result = [];
        let start = range.start_byte;
        while (start < range.end_byte) {
            let end = Math.min(range.end_byte, start + policy.target_bytes);
            while (end < data.length && (data[end] & 0xc0) === 0x80)
                end--;
            if (end < range.end_byte) {
                const newline = data.lastIndexOf(10, end - 1);
                if (newline > start + policy.target_bytes / 2)
                    end = newline + 1;
            }
            result.push(chunk(owner, span(owner.path, start, end), `${owner.name}/window-${start}`));
            if (end === range.end_byte)
                break;
            let next = Math.max(start + 1, end - policy.overlap_bytes);
            while ((data[next] & 0xc0) === 0x80)
                next++;
            const newline = data.indexOf(10, next);
            if (newline >= next && newline + 1 < end)
                next = newline + 1;
            start = next;
        }
        return result;
    };
    const base = index.units.filter(unit => unit.kind === "function" || unit.kind === "method" || unit.kind === "type" ||
        unit.kind === "block" && (units.get(unit.parent_id ?? "")?.kind === "file" ||
            (units.get(unit.parent_id ?? "")?.span.end_byte ?? 0) - (units.get(unit.parent_id ?? "")?.span.start_byte ?? 0) > 6000));
    const whole = (unit) => ({ ...unit, owner_unit_id: unit.id, symbol_names: [unit.name], signatures: [] });
    if (strategy === "unit")
        return base.map(whole);
    if (strategy === "window")
        return index.files.flatMap(file => {
            const owner = (byFile.get(file.path) ?? []).find(unit => unit.kind === "file");
            return windows(owner, owner.span).map(part => {
                const overlapping = (byFile.get(file.path) ?? []).filter(unit => unit.kind !== "file" && unit.kind !== "block" && unit.span.start_byte < part.span.end_byte && unit.span.end_byte > part.span.start_byte);
                part.symbol_names = [...new Set(overlapping.map(unit => unit.name))];
                const enclosing = overlapping.filter(unit => unit.span.start_byte <= part.span.start_byte && unit.span.end_byte >= part.span.end_byte).sort((a, b) => (a.span.end_byte - a.span.start_byte) - (b.span.end_byte - b.span.start_byte))[0];
                part.name = `${enclosing?.name ?? owner.name}/window-${part.span.start_byte}`;
                part.owner_unit_id = enclosing?.id ?? owner.id;
                part.signatures = enclosing && signatures.has(enclosing.id) ? [signatures.get(enclosing.id)] : [];
                return part;
            });
        });
    const result = [];
    for (const unit of base.filter(unit => unit.kind !== "block")) {
        if (unit.span.end_byte - unit.span.start_byte <= policy.target_bytes) {
            result.push(whole(unit));
            continue;
        }
        const blocks = (byFile.get(unit.path) ?? []).filter(child => child.kind === "block" && child.parent_id === unit.id);
        if (!blocks.length) {
            result.push(...windows(unit, unit.span));
            continue;
        }
        for (const block of blocks) {
            if (block.span.end_byte - block.span.start_byte > policy.target_bytes)
                result.push(...windows(unit, block.span));
            else
                result.push(chunk(unit, block.span, block.name));
        }
    }
    return [...new Map(result.map(part => [part.id, part])).values()];
}
