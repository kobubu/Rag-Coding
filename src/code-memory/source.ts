import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";

export function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
}

export function snapshotId(files: { path: string; sha256: string }[], compiler: string, configHash: string): string {
  return "snapshot:" + hash(JSON.stringify({ files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    compiler, configHash, policy: "cm-local-0.1" }));
}

export const ANALYSIS_FILES = ["tsconfig.json", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
export const MAX_INDEX_BYTES = 128 * 1024 * 1024;

export function isSourcePath(path: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) && !/\.d\.(?:ts|mts|cts)$/.test(path);
}

export function byteOffsets(source: string): Int32Array {
  const offsets = new Int32Array(source.length + 1);
  let bytes = 0;
  for (let position = 0; position < source.length; position++) {
    offsets[position] = bytes;
    const point = source.codePointAt(position)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (point > 0xffff) offsets[++position] = -1;
  }
  offsets[source.length] = bytes;
  return offsets;
}

export class CMError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "CMError";
  }
}

export function byteOffset(source: string, position: number): number {
  if (!Number.isInteger(position) || position < 0 || position > source.length) {
    throw new CMError("invalid_source_range", "Invalid UTF-16 position");
  }
  const left = source.charCodeAt(position - 1);
  const right = source.charCodeAt(position);
  if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) {
    throw new CMError("invalid_source_range", "Position splits a surrogate pair");
  }
  return Buffer.byteLength(source.slice(0, position), "utf8");
}

export function utf8(raw: Buffer): string {
  const source = raw.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(raw)) throw new CMError("unsupported_encoding", "Only exact UTF-8 is supported");
  return source;
}
