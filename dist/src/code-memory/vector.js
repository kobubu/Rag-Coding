import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { CMError, hash } from "./source.js";
import { chunkingPolicy, projectChunks } from "./chunks.js";
import { bounded } from "./query.js";
export const EMBEDDING = { model: "Xenova/all-MiniLM-L6-v2", revision: "751bff37182d3f1213fa05d7196b954e230abad9", dtype: "q8", dimensions: 384, projection: "cm-hybrid-1" };
const models = new Map();
const sourceBuffers = new WeakMap();
export function localEmbedder(cache, allowDownload = false) {
    const key = resolve(cache) + ":" + allowDownload;
    return async (texts, signal) => {
        signal?.throwIfAborted();
        if (!allowDownload) {
            const { miniLMEmbedder } = await import("./minilm.js");
            return miniLMEmbedder(cache)(texts, signal);
        }
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
        return output.tolist();
    };
}
export function sourceSlice(index, unit) {
    const file = index.files.find((item) => item.path === unit.path);
    let cached = sourceBuffers.get(file);
    if (!cached || cached.source !== file.source) {
        cached = { source: file.source, bytes: Buffer.from(file.source, "utf8") };
        sourceBuffers.set(file, cached);
    }
    return cached.bytes.subarray(unit.span.start_byte, unit.span.end_byte).toString("utf8");
}
export function words(text) {
    return text.replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\d]+/gu) ?? [];
}
function records(index, chunks) {
    return chunks
        .map((unit) => {
        const code = sourceSlice(index, unit);
        const text = [...words(unit.path + " " + unit.name), ...words(code.slice(0, 1800))].slice(0, 200).join(" ");
        return { id: unit.id, path: unit.path, text, fingerprint: hash(JSON.stringify([EMBEDDING, text])) };
    });
}
function checkVector(vector) {
    if (vector.length !== EMBEDDING.dimensions || vector.some((value) => !Number.isFinite(value)))
        throw new CMError("invalid_vectors", "Embedding shape or values are invalid");
}
export async function buildVectors(index, config, embed = localEmbedder(config.modelCache, config.allowDownload), signal) {
    const started = performance.now();
    signal?.throwIfAborted();
    const chunks = projectChunks(index, config.chunking);
    const entries = records(index, chunks);
    if (!entries.length)
        throw new CMError("empty_vectors", "No retrievable source units");
    const cachePath = config.embeddingCache ?? join(config.directory, "embedding-cache.json");
    const cached = {};
    try {
        const previous = JSON.parse(await readFile(cachePath, "utf8"));
        if (JSON.stringify(previous.embedding) === JSON.stringify(EMBEDDING))
            Object.assign(cached, previous.values);
    }
    catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
            throw error;
    }
    const missing = [...new Map(entries.filter((entry) => !cached[entry.fingerprint]).map((entry) => [entry.fingerprint, entry])).values()];
    for (let start = 0; start < missing.length; start += 16) {
        signal?.throwIfAborted();
        const batch = missing.slice(start, start + 16);
        const vectors = await embed(batch.map((entry) => entry.text), signal);
        if (vectors.length !== batch.length)
            throw new CMError("invalid_vectors", "Embedding batch size mismatch");
        for (const [position, entry] of batch.entries()) {
            checkVector(vectors[position]);
            cached[entry.fingerprint] = vectors[position];
        }
    }
    for (const entry of entries)
        checkVector(cached[entry.fingerprint]);
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
    const manifest = { format: "cm-vectors-2", snapshot_id: index.snapshot_id, embedding: EMBEDDING, chunking: chunkingPolicy(config.chunking), table: name, records_hash: recordsHash, rows: entries.length };
    const temporary = join(config.directory, "manifest." + globalThis.process.pid + ".tmp");
    await writeFile(temporary, JSON.stringify(manifest, null, 2));
    await rename(temporary, join(config.directory, "manifest.json"));
    table.close();
    database.close();
    return { rows: entries.length, embedded: missing.length, reused: entries.length - missing.length, milliseconds: performance.now() - started, embedding: EMBEDDING };
}
export class LocalVectors {
    config;
    embed;
    opened;
    projection;
    constructor(config, embed = localEmbedder(config.modelCache)) {
        this.config = config;
        this.embed = embed;
    }
    chunks(index) {
        if (this.projection?.index !== index) {
            const chunks = projectChunks(index, this.config.chunking);
            this.projection = { index, chunks, recordsHash: hash(JSON.stringify(records(index, chunks).map(({ id, fingerprint }) => [id, fingerprint]))) };
        }
        return this.projection.chunks;
    }
    async metadata(index, signal) {
        signal?.throwIfAborted();
        const manifest = JSON.parse(await readFile(join(this.config.directory, "manifest.json"), "utf8"));
        const chunks = this.chunks(index);
        if (manifest.format !== "cm-vectors-2" || manifest.snapshot_id !== index.snapshot_id || JSON.stringify(manifest.embedding) !== JSON.stringify(EMBEDDING) ||
            JSON.stringify(manifest.chunking) !== JSON.stringify(chunkingPolicy(this.config.chunking)) || manifest.records_hash !== this.projection.recordsHash || manifest.rows !== chunks.length) {
            throw new CMError("vectors_outdated", "Rebuild the vector projection for this source snapshot/model");
        }
        if (!/^cm_[0-9a-f]{32}$/.test(manifest.table))
            throw new CMError("invalid_vectors", "Invalid vector table identity");
        if (manifest.ann && (manifest.ann.type !== "IVF_HNSW_SQ" || [manifest.ann.partitions, manifest.ann.m, manifest.ann.ef_construction, manifest.ann.ef_search, manifest.ann.refine_factor].some(value => !Number.isInteger(value) || value < 1))) {
            throw new CMError("invalid_vectors", "Invalid ANN settings");
        }
        if (this.config.searchMode === "ann" && !manifest.ann)
            throw new CMError("vectors_outdated", "Build the ANN projection before selecting ann search");
        return manifest;
    }
    async search(index, query, limit = 24, signal) {
        signal?.throwIfAborted();
        if (!query.trim() || query.length > 16000)
            throw new CMError("invalid_argument", "query must contain 1..16000 characters");
        limit = bounded(limit, 24, 50, "limit");
        const manifest = await this.metadata(index, signal);
        const chunks = this.chunks(index);
        if (this.opened?.snapshot !== index.snapshot_id) {
            this.close();
            const { connect } = await import("@lancedb/lancedb");
            const database = await connect(resolve(this.config.directory));
            const table = await database.openTable(manifest.table);
            this.opened = { snapshot: index.snapshot_id, table, close: () => { table.close(); database.close(); } };
        }
        const [vector] = await this.embed([query], signal);
        checkVector(vector);
        let search = this.opened.table.vectorSearch(vector).distanceType("cosine").limit(limit);
        if (this.config.searchMode === "ann") {
            if (!manifest.ann)
                throw new CMError("vectors_outdated", "Build the ANN projection before selecting ann search");
            const indices = await this.opened.table.listIndices();
            if (!indices.some(item => item.columns.includes("vector") && item.indexType.toUpperCase().includes("HNSW")))
                throw new CMError("vectors_outdated", "The declared HNSW index is unavailable");
            search = search.nprobes(manifest.ann.partitions).ef(Math.max(manifest.ann.ef_search, limit * manifest.ann.refine_factor)).refineFactor(manifest.ann.refine_factor);
        }
        else
            search = search.bypassVectorIndex();
        const results = await search.select(["id", "_distance"]).toArray();
        signal?.throwIfAborted();
        const ids = new Set(chunks.map((unit) => unit.id));
        if (results.some((item) => !ids.has(String(item.id))))
            throw new CMError("invalid_vectors", "Vector results refer to another snapshot");
        return results.map((item) => ({ id: String(item.id), score: 1 - Number(item._distance) }));
    }
    close() { this.opened?.close(); this.opened = undefined; }
}
export async function buildAnn(index, config) {
    const vectors = new LocalVectors(config);
    const manifest = await vectors.metadata(index);
    if (manifest.rows < 256)
        throw new CMError("index_limit", "HNSW requires at least 256 records in this projection");
    const { connect, Index } = await import("@lancedb/lancedb");
    const database = await connect(resolve(config.directory));
    const table = await database.openTable(manifest.table);
    const started = performance.now();
    try {
        await table.createIndex("vector", { config: Index.hnswSq({ distanceType: "cosine", numPartitions: 1, m: 16, efConstruction: 200 }), replace: true });
        const ann = { type: "IVF_HNSW_SQ", partitions: 1, m: 16, ef_construction: 200, ef_search: 128, refine_factor: 4 };
        const path = join(config.directory, "manifest.json"), temporary = path + "." + process.pid + ".tmp";
        await writeFile(temporary, JSON.stringify({ ...manifest, ann }, null, 2));
        await rename(temporary, path);
        return { rows: manifest.rows, ann, milliseconds: performance.now() - started };
    }
    finally {
        table.close();
        database.close();
        vectors.close();
    }
}
