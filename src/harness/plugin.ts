import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolve } from "node:path";
import { codeSearch, contextGet, graphExpand, symbolSearch } from "../code-memory/query.js";
import { CMStore } from "../code-memory/store.js";

export const name = "code-memory";
export const inject = ["tools"];

export interface Config {
  projectRoot?: string;
  indexPath?: string;
}

export function apply(ctx: Context, config: Config = {}): void {
  const root = resolve(config.projectRoot ?? process.env.CM_PROJECT_ROOT ?? process.cwd());
  const store = new CMStore(root, resolve(root, config.indexPath ?? process.env.CM_INDEX_PATH ?? ".code-memory/index.json"));
  const output = {
    schema: { type: "object", additionalProperties: true } as const,
    render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: JSON.stringify(value) }],
  };
  ctx.tools.register(defineTool({ name: "cm_symbol_search", description: "Search CM (Code Memory) glossary symbols. Returns snapshot and exact source spans. Read-only.",
    parameters: { query: { type: "string", required: true }, limit: { type: "integer" }, snapshot_id: { type: "string" } }, output,
    async execute(args, exec) { return symbolSearch(await store.load(exec.signal, args.snapshot_id), args.query, args.limit); },
  }));
  ctx.tools.register(defineTool({ name: "cm_code_search", description: "Search CM function/method code by exact name and lexical text. No vector search in v0.1. Read-only.",
    parameters: { query: { type: "string", required: true }, limit: { type: "integer" }, snapshot_id: { type: "string" } }, output,
    async execute(args, exec) { return codeSearch(await store.load(exec.signal, args.snapshot_id), args.query, args.limit); },
  }));
  ctx.tools.register(defineTool({ name: "cm_context_get", description: "Get exact CM source and lexical parents/dependencies for a unit or symbol ID from search. Snapshot required; omissions are explicit. Read-only.",
    parameters: { id: { type: "string", required: true }, snapshot_id: { type: "string", required: true }, max_bytes: { type: "integer" } }, output,
    async execute(args, exec) { return contextGet(await store.load(exec.signal, args.snapshot_id), args.id, args.max_bytes); },
  }));
  ctx.tools.register(defineTool({ name: "cm_graph_expand", description: "Expand CM structural edges with source evidence. Pass a node ID and snapshot from search. Bounded to depth 3 / 100 nodes; read-only.",
    parameters: { id: { type: "string", required: true }, snapshot_id: { type: "string", required: true }, depth: { type: "integer" },
      max_nodes: { type: "integer" }, predicate: { type: "string" } }, output,
    async execute(args, exec) { return graphExpand(await store.load(exec.signal, args.snapshot_id), args.id, args.depth, args.max_nodes, args.predicate); },
  }));
}
