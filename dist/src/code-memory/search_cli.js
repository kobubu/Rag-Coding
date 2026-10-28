#!/usr/bin/env node
import { resolve } from "node:path";
import { CMStore } from "./store.js";
import { LocalVectors, EMBEDDING } from "./vector.js";
import { retrieveContext } from "./retrieve.js";
import { CMError } from "./source.js";
import { bounded } from "./query.js";
import { chunkingPolicy } from "./chunks.js";
const options = new Map();
const allowed = new Set(["--project", "--index", "--vectors", "--model-cache", "--query", "--mode", "--chunking", "--limit", "--max-bytes", "--search-mode", "--retrieval-policy", "--detail"]);
for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!allowed.has(key) || value === undefined || value.startsWith("--") || options.has(key)) {
        throw new CMError("invalid_argument", "Usage: cm-search --query text [--project directory] [--mode vector|hybrid]");
    }
    options.set(key, value);
}
const query = options.get("--query") ?? "";
if (!query.trim() || query.length > 16000)
    throw new CMError("invalid_argument", "query must contain 1..16000 characters");
const mode = options.get("--mode") ?? "hybrid";
if (mode !== "vector" && mode !== "hybrid")
    throw new CMError("invalid_argument", "mode must be vector or hybrid");
const limit = bounded(options.has("--limit") ? Number(options.get("--limit")) : undefined, 5, 50, "limit");
const budget = bounded(options.has("--max-bytes") ? Number(options.get("--max-bytes")) : undefined, 6000, 32000, "max_bytes");
const root = resolve(options.get("--project") ?? ".");
const chunking = (options.get("--chunking") ?? "unit");
chunkingPolicy(chunking);
const searchMode = options.get("--search-mode") ?? "exact";
if (searchMode !== "exact" && searchMode !== "ann")
    throw new CMError("invalid_argument", "search-mode must be exact or ann");
const signal = new AbortController().signal;
const policy = (options.get("--retrieval-policy") ?? "hybrid"), detail = (options.get("--detail") ?? "focused");
if (!["hybrid", "graph", "adaptive"].includes(policy) || !["focused", "expanded"].includes(detail))
    throw new CMError("invalid_argument", "Invalid retrieval policy or detail");
const index = await new CMStore(root, resolve(root, options.get("--index") ?? ".code-memory/index.json")).load(signal);
const vectors = new LocalVectors({ directory: resolve(root, options.get("--vectors") ?? ".code-memory/vectors"),
    modelCache: resolve(root, options.get("--model-cache") ?? ".code-memory/models"), chunking, searchMode });
try {
    if (mode === "vector") {
        const chunks = new Map(vectors.chunks(index).map(chunk => [chunk.id, chunk]));
        const hits = await vectors.search(index, query, limit, signal);
        console.log(JSON.stringify({ memory: "CM — Code Memory", snapshot_id: index.snapshot_id,
            channels: ["local-dense-vector"], embedding: EMBEDDING,
            matches: hits.map(hit => { const chunk = chunks.get(hit.id); return { id: hit.id, name: chunk.name, path: chunk.path, span: chunk.span, cosine_similarity: hit.score }; }) }));
    }
    else {
        console.log(JSON.stringify(await retrieveContext(index, vectors, query, budget, signal, { policy, detail })));
    }
}
finally {
    vectors.close();
}
