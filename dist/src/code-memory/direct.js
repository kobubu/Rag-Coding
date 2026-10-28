import { open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { CMError, hash, inside, utf8 } from "./source.js";
import { ts } from "./ts.js";
export async function directFileContext(root, query, budget, signal, scope) {
    signal?.throwIfAborted();
    if (!query.trim() || query.length > 16000)
        throw new CMError("invalid_argument", "query must contain 1..16000 characters");
    const paths = [...new Set([...query.matchAll(/(?<![\p{L}\p{N}_.$/\\-])[\p{L}\p{N}_.$/-]+\.(?:[cm]?[jt]sx?)(?![\p{L}\p{N}_$])/gu)].map(match => match[0]))];
    if (paths.length !== 1 || !Number.isInteger(budget) || budget < 1 || budget > 32000)
        return;
    const path = paths[0];
    if (path.includes("..") || path.startsWith("/") || scope && !path.startsWith(scope.replace(/\\/g, "/").replace(/\/$/, "") + "/"))
        return;
    const realRoot = await realpath(root);
    let actual;
    try {
        actual = await realpath(resolve(root, path));
    }
    catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
            return;
        throw error;
    }
    if (!inside(realRoot, actual) || scope && !inside(resolve(realRoot, scope), actual))
        return;
    const file = await open(actual, "r");
    try {
        const before = await file.stat({ bigint: true });
        // Keep this route small regardless of a caller's expanded byte budget.
        if (!before.isFile() || before.size > BigInt(Math.min(6000, budget)))
            return;
        const buffer = Buffer.alloc(Math.min(6000, budget) + 1), { bytesRead } = await file.read(buffer, 0, buffer.length, 0), after = await file.stat({ bigint: true });
        signal?.throwIfAborted();
        if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytesRead) !== after.size || await realpath(resolve(root, path)) !== actual)
            throw new CMError("index_outdated", "File changed during direct CM read; retry");
        const raw = buffer.subarray(0, bytesRead), source = utf8(raw), digest = hash(raw);
        const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        let external = false;
        const visit = (node) => {
            if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node) && node.moduleSpecifier ||
                ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require"))
                external = true;
            ts.forEachChild(node, visit);
        };
        visit(syntax);
        if (external)
            return;
        return { snapshot_id: "file:" + digest, channels: ["current-saved-file"], bytes_used: raw.length,
            parts: [{ path, whole: true, reason: "match", span: { file_version_id: "blob:" + digest, start_byte: 0, end_byte: raw.length, line_start: 1, line_end: source.slice(0, -1).split("\n").length }, text: source }],
            omissions: 0, complete: false, retrieval: { policy: "adaptive", route: "named", detail: "focused", roots: 1, graph_nodes: 0, bindings_shown: 0, bindings_omitted: 0, dense_search: false },
            notes: ["Current saved file, including local definitions. External compiler dependencies are not expanded; use expanded context when needed."] };
    }
    finally {
        await file.close();
    }
}
