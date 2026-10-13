import { resolve } from "node:path";
import { CMError } from "../code-memory/source.js";
import { chunkingPolicy } from "../code-memory/chunks.js";
import type { ChunkingStrategy } from "../code-memory/chunks.js";
import type { AgentConfig } from "./service.js";
import type { RetrievalPolicy } from "../code-memory/graph_retrieve.js";
export function agentOptions(args: string[]): AgentConfig & { port: number } {
  const allowed = new Set(["--project", "--index", "--vectors", "--model-cache", "--chunking", "--search-mode", "--retrieval-policy", "--auto-update", "--memory-dir", "--embedding-cache", "--source-scope", "--port"]), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!allowed.has(key) || !value || value.startsWith("--") || options.has(key)) throw new CMError("invalid_argument", "Use --project directory [--index path --vectors directory --model-cache directory --chunking unit|window|ast --search-mode exact|ann --port number]");
    options.set(key, value);
  }
  const chunking = (options.get("--chunking") ?? "unit") as ChunkingStrategy;
  chunkingPolicy(chunking);
  const mode = options.get("--search-mode") ?? "exact";
  if (mode !== "exact" && mode !== "ann") throw new CMError("invalid_argument", "search-mode must be exact or ann");
  const policy = (options.get("--retrieval-policy") ?? "hybrid") as RetrievalPolicy;
  if (!["hybrid", "graph", "adaptive"].includes(policy)) throw new CMError("invalid_argument", "retrieval-policy must be hybrid, graph or adaptive");
  const port = Number(options.get("--port") ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CMError("invalid_argument", "Invalid port");
  const projectRoot = resolve(options.get("--project") ?? ".");
  const update = options.get("--auto-update") ?? "false";if (update !== "true" && update !== "false") throw new CMError("invalid_argument", "auto-update must be true or false");
  return { projectRoot, indexPath: resolve(projectRoot, options.get("--index") ?? ".code-memory/index.json"),
    vectorsPath: resolve(projectRoot, options.get("--vectors") ?? ".code-memory/vectors"), modelCache: resolve(projectRoot, options.get("--model-cache") ?? ".code-memory/models"), chunking, searchMode: mode, retrievalPolicy: policy, port, autoUpdate: update === "true",
    ...(options.has("--memory-dir") ? { memoryDirectory: resolve(projectRoot, options.get("--memory-dir")!) } : {}), ...(options.has("--embedding-cache") ? { embeddingCache: resolve(projectRoot, options.get("--embedding-cache")!) } : {}),
    ...(options.has("--source-scope") ? { sourceScope: options.get("--source-scope")! } : {}) };
}
