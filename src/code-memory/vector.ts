import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Table } from "@lancedb/lancedb";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { CMError, hash } from "./source.js";
import type { CMIndex, CMUnit } from "./types.js";

export const EMBEDDING = { model: "Xenova/all-MiniLM-L6-v2", revision: "751bff37182d3f1213fa05d7196b954e230abad9", dtype: "q8", dimensions: 384, projection: "cm-hybrid-1" } as const;
export type Embedder = (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
export type VectorConfig = { directory: string; modelCache: string; embeddingCache?: string; allowDownload?: boolean };
type RecordUnit = { id: string; path: string; text: string; fingerprint: string };
type Manifest = { format: "cm-vectors-1"; snapshot_id: string; embedding: typeof EMBEDDING; table: string; records_hash: string; rows: number };
const models = new Map<string, Promise<FeatureExtractionPipeline>>();

export function localEmbedder(cache: string, allowDownload = false): Embedder {
  const key = resolve(cache) + ":" + allowDownload;
  return async (texts, signal) => {
    signal?.throwIfAborted();
    let model = models.get(key);
    if (!model) {
      const { pipeline } = await import("@huggingface/transformers");
      model = pipeline("feature-extraction", EMBEDDING.model, { revision: EMBEDDING.revision, dtype: EMBEDDING.dtype,
        device: "cpu", cache_dir: resolve(cache), local_files_only: !allowDownload,
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
      models.set(key, model);
      model.catch(() => models.delete(key));
    }
    const output = await (await model)(texts, { pooling: "mean", normalize: true });
    signal?.throwIfAborted();
    return output.tolist() as number[][];
  };
}

export function sourceSlice(index: CMIndex, unit: CMUnit): string {
  const file = index.files.find((item) => item.path === unit.path)!;
  return Buffer.from(file.source, "utf8").subarray(unit.span.start_byte, unit.span.end_byte).toString("utf8");
}

export function words(text: string): string[] {
  return text.replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\d]+/gu) ?? [];
}

function records(index: CMIndex): RecordUnit[] {
  const byId = new Map(index.units.map((unit) => [unit.id, unit]));
  return index.units.filter((unit) => unit.kind === "function" || unit.kind === "method" || unit.kind === "type" ||
    unit.kind === "block" && (byId.get(unit.parent_id ?? "")?.kind === "file" ||
      (byId.get(unit.parent_id ?? "")?.span.end_byte ?? 0) - (byId.get(unit.parent_id ?? "")?.span.start_byte ?? 0) > 6000))
    .map((unit) => {
      const code = sourceSlice(index, unit);
      const text = [...words(unit.path + " " + unit.name), ...words(code.slice(0, 1800))].slice(0, 200).join(" ");
      return { id: unit.id, path: unit.path, text, fingerprint: hash(JSON.stringify([EMBEDDING, text])) };
    });
}

function checkVector(vector: number[]): void {
  if (vector.length !== EMBEDDING.dimensions || vector.some((value) => !Number.isFinite(value))) throw new CMError("invalid_vectors", "Embedding shape or values are invalid");
}

export async function buildVectors(index: CMIndex, config: VectorConfig, embed = localEmbedder(config.modelCache, config.allowDownload), signal?: AbortSignal) {
  const started = performance.now();
  signal?.throwIfAborted();
  const entries = records(index);
  if (!entries.length) throw new CMError("empty_vectors", "No retrievable source units");
  const cachePath = config.embeddingCache ?? join(config.directory, "embedding-cache.json");
  const cached: Record<string, number[]> = {};
  try {
    const previous = JSON.parse(await readFile(cachePath, "utf8")) as { embedding: unknown; values: Record<string, number[]> };
    if (JSON.stringify(previous.embedding) === JSON.stringify(EMBEDDING)) Object.assign(cached, previous.values);
  } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  const missing = [...new Map(entries.filter((entry) => !cached[entry.fingerprint]).map((entry) => [entry.fingerprint, entry])).values()];
  for (let start = 0; start < missing.length; start += 16) {
    signal?.throwIfAborted();
    const batch = missing.slice(start, start + 16);
    const vectors = await embed(batch.map((entry) => entry.text), signal);
    if (vectors.length !== batch.length) throw new CMError("invalid_vectors", "Embedding batch size mismatch");
    for (const [position, entry] of batch.entries()) { checkVector(vectors[position]!); cached[entry.fingerprint] = vectors[position]!; }
  }
  for (const entry of entries) checkVector(cached[entry.fingerprint]!);
  await mkdir(config.directory, { recursive: true });
  await mkdir(resolve(cachePath, ".."), { recursive: true });
  const cacheTemp = cachePath + "." + globalThis.process.pid + ".tmp";
  await writeFile(cacheTemp, JSON.stringify({ embedding: EMBEDDING, values: cached }));
  await rename(cacheTemp, cachePath);
  const { connect } = await import("@lancedb/lancedb");
  const database = await connect(resolve(config.directory));
  const recordsHash = hash(JSON.stringify(entries.map(({ id, fingerprint }) => [id, fingerprint])));
  const name = "cm_" + hash(index.snapshot_id + recordsHash).slice(0, 32);
  const table = await database.createTable(name, entries.map((entry) => ({ id: entry.id, path: entry.path, fingerprint: entry.fingerprint, vector: cached[entry.fingerprint] })), { mode: "overwrite" });
  const manifest: Manifest = { format: "cm-vectors-1", snapshot_id: index.snapshot_id, embedding: EMBEDDING, table: name, records_hash: recordsHash, rows: entries.length };
  const temporary = join(config.directory, "manifest." + globalThis.process.pid + ".tmp");
  await writeFile(temporary, JSON.stringify(manifest, null, 2));
  await rename(temporary, join(config.directory, "manifest.json"));
  table.close(); database.close();
  return { rows: entries.length, embedded: missing.length, reused: entries.length - missing.length, milliseconds: performance.now() - started, embedding: EMBEDDING };
}

export class LocalVectors {
  private opened: { snapshot: string; table: Table; close: () => void } | undefined;
  constructor(readonly config: VectorConfig, private readonly embed = localEmbedder(config.modelCache)) {}
  async search(index: CMIndex, query: string, limit = 24, signal?: AbortSignal): Promise<{ id: string; score: number }[]> {
    signal?.throwIfAborted();
    const manifest = JSON.parse(await readFile(join(this.config.directory, "manifest.json"), "utf8")) as Manifest;
    if (manifest.format !== "cm-vectors-1" || manifest.snapshot_id !== index.snapshot_id || JSON.stringify(manifest.embedding) !== JSON.stringify(EMBEDDING)) {
      throw new CMError("vectors_outdated", "Rebuild the vector projection for this source snapshot/model");
    }
    if (!/^cm_[0-9a-f]{32}$/.test(manifest.table)) throw new CMError("invalid_vectors", "Invalid vector table identity");
    if (this.opened?.snapshot !== index.snapshot_id) {
      this.close();
      const { connect } = await import("@lancedb/lancedb");
      const database = await connect(resolve(this.config.directory));
      const table = await database.openTable(manifest.table);
      this.opened = { snapshot: index.snapshot_id, table, close: () => { table.close(); database.close(); } };
    }
    const [vector] = await this.embed([query], signal);
    checkVector(vector!);
    const results = await this.opened.table.vectorSearch(vector!).distanceType("cosine").limit(limit).select(["id", "_distance"]).toArray();
    signal?.throwIfAborted();
    const ids = new Set(index.units.map((unit) => unit.id));
    if (results.some((item) => !ids.has(String(item.id)))) throw new CMError("invalid_vectors", "Vector results refer to another snapshot");
    return results.map((item) => ({ id: String(item.id), score: 1 - Number(item._distance) }));
  }
  close(): void { this.opened?.close(); this.opened = undefined; }
}
