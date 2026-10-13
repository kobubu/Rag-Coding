import { resolve } from "node:path";
import { CMError } from "../code-memory/source.js";
import { chunkingPolicy } from "../code-memory/chunks.js";
import type { ChunkingStrategy } from "../code-memory/chunks.js";
import type { AgentConfig } from "./service.js";
export function agentOptions(args: string[]): AgentConfig & { port: number } {
  const allowed = new Set(["--project", "--index", "--vectors", "--model-cache", "--chunking", "--search-mode", "--port"]), options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!allowed.has(key) || !value || value.startsWith("--") || options.has(key)) throw new CMError("invalid_argument", "Use --project directory [--index path --vectors directory --model-cache directory --chunking unit|window|ast --search-mode exact|ann --port number]");
    options.set(key, value);
  }
  const chunking = (options.get("--chunking") ?? "unit") as ChunkingStrategy;
  chunkingPolicy(chunking);
  const mode = options.get("--search-mode") ?? "exact";
  if (mode !== "exact" && mode !== "ann") throw new CMError("invalid_argument", "search-mode must be exact or ann");
  const port = Number(options.get("--port") ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CMError("invalid_argument", "Invalid port");
  const projectRoot = resolve(options.get("--project") ?? ".");
  return { projectRoot, indexPath: resolve(projectRoot, options.get("--index") ?? ".code-memory/index.json"),
    vectorsPath: resolve(projectRoot, options.get("--vectors") ?? ".code-memory/vectors"), modelCache: resolve(projectRoot, options.get("--model-cache") ?? ".code-memory/models"), chunking, searchMode: mode, port };
}
