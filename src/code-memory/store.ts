import { readFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ANALYSIS_FILES, CMError, hash, inside, snapshotId, utf8 } from "./source.js";
import type { CMIndex, SourceSpan } from "./types.js";

const schema = JSON.parse(readFileSync(new URL("../../../contracts/cm-local.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile<CMIndex>(schema);
const MAX_INDEX_BYTES = 16 * 1024 * 1024;

export function validateIndex(value: unknown): CMIndex {
  if (!validate(value)) throw new CMError("invalid_index", JSON.stringify(validate.errors));
  const index = value;
  if (new Set(index.analysis_inputs.map((input) => input.path)).size !== index.analysis_inputs.length ||
    index.analysis_inputs.some((input) => !ANALYSIS_FILES.includes(input.path))) throw new CMError("invalid_index", "Invalid analysis input");
  if (index.snapshot_id !== snapshotId(index.files, index.analyzer.version, index.analysis_config_hash)) {
    throw new CMError("invalid_index", "Snapshot fingerprint does not match manifest");
  }
  const files = new Map(index.files.map((file) => [file.path, file]));
  const units = new Map(index.units.map((unit) => [unit.id, unit]));
  const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
  const relations = new Set(index.relations.map((relation) => relation.id));
  if (files.size !== index.files.length || units.size !== index.units.length || symbols.size !== index.symbols.length ||
    relations.size !== index.relations.length) throw new CMError("invalid_index", "Duplicate identities");
  const byBlob = new Map(index.files.map((file) => ["blob:" + file.sha256, file]));
  for (const file of index.files) {
    if (file.path.includes("\\") || file.path.includes(":") || file.path.split("/").some((part) => !part || part === ".." || part === ".") ||
      !/\.(?:ts|tsx|mts|cts)$/.test(file.path) || hash(Buffer.from(file.source, "utf8")) !== file.sha256) {
      throw new CMError("invalid_index", "Invalid source path or blob hash");
    }
  }
  function checkSpan(span: SourceSpan, path?: string): void {
    const file = byBlob.get(span.file_version_id);
    if (!file || path && files.get(path)?.sha256 !== file.sha256) throw new CMError("invalid_index", "Span belongs to another blob");
    const raw = Buffer.from(file.source, "utf8");
    if (span.start_byte > span.end_byte || span.end_byte > raw.length || span.line_start > span.line_end) throw new CMError("invalid_index", "Invalid source range");
    utf8(raw.subarray(0, span.start_byte));
    utf8(raw.subarray(span.start_byte, span.end_byte));
  }
  for (const unit of index.units) {
    if (symbols.has(unit.id)) throw new CMError("invalid_index", "Node identity collision");
    checkSpan(unit.span, unit.path);
    if (unit.parent_id !== null) {
      const parent = units.get(unit.parent_id);
      if (!parent || parent.id === unit.id || parent.path !== unit.path || parent.span.start_byte > unit.span.start_byte ||
        parent.span.end_byte < unit.span.end_byte) throw new CMError("invalid_index", "Invalid unit parent");
      const seen = new Set([unit.id]);
      let ancestor = parent;
      while (ancestor.parent_id !== null) {
        if (seen.has(ancestor.id)) throw new CMError("invalid_index", "Unit parent cycle");
        seen.add(ancestor.id);
        const next = units.get(ancestor.parent_id);
        if (!next) throw new CMError("invalid_index", "Missing ancestor");
        ancestor = next;
      }
    }
    if (unit.required_symbol_ids.some((id) => !symbols.has(id))) throw new CMError("invalid_index", "Unknown required symbol");
  }
  for (const symbol of index.symbols) {
    checkSpan(symbol.span, symbol.path);
    checkSpan(symbol.declaration_span, symbol.path);
    if (!units.has(symbol.owner_unit_id)) throw new CMError("invalid_index", "Unknown symbol owner");
  }
  for (const relation of index.relations) {
    if (![relation.from_id, relation.to_id].every((id) => units.has(id) || symbols.has(id))) throw new CMError("invalid_index", "Dangling graph edge");
    checkSpan(relation.evidence);
  }
  return index;
}

export class CMStore {
  readonly projectRoot: string;
  readonly indexPath: string;

  constructor(projectRoot: string, indexPath: string) {
    this.projectRoot = resolve(projectRoot);
    this.indexPath = resolve(indexPath);
  }

  async load(signal: AbortSignal, expectedSnapshot?: string): Promise<CMIndex> {
    signal.throwIfAborted();
    let bytes: number;
    try { bytes = (await stat(this.indexPath)).size; }
    catch { throw new CMError("index_not_ready", "Build the local CM index with cm-index before using the plugin"); }
    if (bytes > MAX_INDEX_BYTES) throw new CMError("index_limit", "Index exceeds 16 MiB");
    const raw = await readFile(this.indexPath, { signal });
    if (raw.length > MAX_INDEX_BYTES) throw new CMError("index_limit", "Index exceeds 16 MiB");
    let parsed: unknown;
    try { parsed = JSON.parse(utf8(raw)); } catch (error) { throw new CMError("invalid_index", String(error)); }
    const index = validateIndex(parsed);
    if (expectedSnapshot && expectedSnapshot !== index.snapshot_id) throw new CMError("snapshot_mismatch", "Re-run search against the current CM snapshot");
    const root = await realpath(this.projectRoot);
    for (const input of index.analysis_inputs) {
      signal.throwIfAborted();
      let path: string;
      try { path = await realpath(resolve(root, input.path)); }
      catch { throw new CMError("index_outdated", `Analysis input removed: ${input.path}`); }
      if (!inside(root, path) || hash(await readFile(path, { signal })) !== input.sha256) {
        throw new CMError("index_outdated", `Analysis input changed: ${input.path}; rebuild CM`);
      }
    }
    for (const file of index.files) {
      signal.throwIfAborted();
      let sourcePath: string;
      try { sourcePath = await realpath(resolve(root, file.path)); } catch { throw new CMError("index_outdated", `Source removed: ${file.path}`); }
      if (!inside(root, sourcePath)) throw new CMError("source_outside_project", file.path);
      if (hash(await readFile(sourcePath, { signal })) !== file.sha256) throw new CMError("index_outdated", `Source changed: ${file.path}; rebuild CM`);
    }
    signal.throwIfAborted();
    return index;
  }
}
