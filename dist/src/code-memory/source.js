import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
export function hash(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function inside(root, path) {
    const rel = relative(root, path);
    return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}
export function snapshotId(files, compiler, configHash) {
    return "snapshot:" + hash(JSON.stringify({ files: files.map(({ path, sha256 }) => ({ path, sha256 })),
        compiler, configHash, policy: "cm-local-0.1" }));
}
export const ANALYSIS_FILES = ["tsconfig.json", "jsconfig.json", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
export const MAX_INDEX_BYTES = 128 * 1024 * 1024;
export function isSourcePath(path) {
    return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && !/\.d\.(?:ts|mts|cts)$/.test(path);
}
export function byteOffsets(source) {
    const offsets = new Int32Array(source.length + 1);
    let bytes = 0;
    for (let position = 0; position < source.length; position++) {
        offsets[position] = bytes;
        const point = source.codePointAt(position);
        bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (point > 0xffff)
            offsets[++position] = -1;
    }
    offsets[source.length] = bytes;
    return offsets;
}
export class CMError extends Error {
    code;
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.name = "CMError";
    }
}
// fatal rejects every byte sequence that does not round-trip; ignoreBOM keeps a leading BOM as text, as Buffer decoding does.
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function utf8(raw) {
    try {
        return STRICT_UTF8.decode(raw);
    }
    catch {
        throw new CMError("unsupported_encoding", "Only exact UTF-8 is supported");
    }
}
