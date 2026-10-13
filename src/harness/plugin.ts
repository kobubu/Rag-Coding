import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import type {} from "@deepseek-ai/dsh-fs";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { LocalVectors } from "../code-memory/vector.js";
import { retrieveContext, renderContext } from "../code-memory/retrieve.js";
import type { RetrievedContext } from "../code-memory/retrieve.js";
import type { CMIndex } from "../code-memory/types.js";
import type { ChunkingStrategy } from "../code-memory/chunks.js";
import { CMError, hash } from "../code-memory/source.js";
import { codeSearch, contextGet, graphExpand, symbolSearch } from "../code-memory/query.js";
import { CMStore } from "../code-memory/store.js";

export const name = "code-memory";
export const inject = ["tools"];

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "code-memory": { kind: "code-memory"; snapshot_id: string; form: "snapshot"; sections: { name: string; text: string }[] };
  }
}

export interface Config {
  projectRoot?: string;
  indexPath?: string;
  mode?: "legacy" | "compact";
  vectorsPath?: string;
  modelCache?: string;
  autoContext?: boolean;
  maxContextBytes?: number;
  diagnosticsPath?: string;
  chunking?: ChunkingStrategy;
}

export function apply(ctx: Context, config: Config = {}): void {
  const root = resolve(config.projectRoot ?? process.env.CM_PROJECT_ROOT ?? process.cwd());
  const store = new CMStore(root, resolve(root, config.indexPath ?? process.env.CM_INDEX_PATH ?? ".code-memory/index.json"));
  const mode = config.mode ?? "compact";
  if (mode !== "compact" && mode !== "legacy") throw new CMError("invalid_argument", "mode must be compact or legacy");
  const autoContext = config.autoContext ?? true;
  if (mode === "compact") {
    ctx.inject(["tools", "systemPrompt", "fs"], (ctx) => {
    const diagnostics: object[] = [];
    const record = (value: object) => { if (config.diagnosticsPath) { diagnostics.push(value); writeFileSync(config.diagnosticsPath, JSON.stringify(diagnostics)); } };
    record({ event: "compact_registered", mode, autoContext });
    const vectors = new LocalVectors({ directory: resolve(root, config.vectorsPath ?? ".code-memory/vectors"),
      modelCache: resolve(root, config.modelCache ?? ".code-memory/models"), chunking: config.chunking ?? "unit" });
    ctx.effect(() => () => vectors.close(), "CM local vector cleanup");
    const observe = async (index: CMIndex, context: RetrievedContext, signal: AbortSignal, actor: object) => {
      for (const path of new Set(context.parts.map((part) => part.path))) {
        const hostPath = resolve(root, path);
        const processPath = ctx.fs.processPathFromHostPath(hostPath);
        if (processPath === undefined) throw new CMError("unsupported_filesystem", "CM source is not accessible in this Harness filesystem");
        const target = await ctx.fs.resolve(processPath, { signal });
        const before = await ctx.fs.stat(target, signal);
        if (!before || before.type !== "file") throw new CMError("index_outdated", "CM file is unavailable");
        const actual = await ctx.fs.readText(target, signal);
        const after = await ctx.fs.stat(target, signal);
        if (before.version !== after?.version || hash(Buffer.from(actual, "utf8")) !== index.files.find((file) => file.path === path)!.sha256) {
          throw new CMError("index_outdated", "CM source changed during context observation");
        }
        ctx.emit("fs/observed", target, { kind: "present", version: after.version }, actor);
      }
    };
    const retrieve = async (query: string, budget: number | undefined, signal: AbortSignal, actor: object) => {
      const index = await store.load(signal);
      const context = await retrieveContext(index, vectors, query, budget ?? config.maxContextBytes ?? 6000, signal);
      await observe(index, context, signal, actor);
      return context;
    };
    ctx.tools.register(defineTool({ name: "cm_retrieve_context", description: "Get compact exact code and dependencies via local hybrid vector search. Files are version-checked and observed for edit. Partial; read more only when needed.",
      parameters: { query: { type: "string", required: true }, max_bytes: { type: "integer" } },
      output: { schema: { type: "object", additionalProperties: true }, render: (_args: unknown, value: RetrievedContext) => [{ type: "text" as const, text: renderContext(value) }] },
      async execute(args, exec) { return retrieve(args.query, args.max_bytes, exec.signal, exec); },
    }));
    ctx.systemPrompt.section({ name: "cm-context-guidance", order: 1350,
      text: "CM source context is already read through this filesystem and version-observed for guarded edit. Apply targeted edits directly when the supplied context suffices; use cm_retrieve_context or read for missing context." });
    if (autoContext) {
      ctx.on("agent/pre-step", async (payload, next) => {
        const decision = await next();
        record({ event: "pre_step", agent: payload.agent.id, kind: decision.kind, messages: decision.kind === "enter" ? decision.messages.length : 0 });
        if (decision.kind !== "enter") return decision;
        const query = payload.messages.filter((message) => message.source.kind === "user").flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
        if (query.trim()) {
          const context = await retrieve(query.slice(0, 16000), undefined, payload.signal, payload);
          const text = renderContext(context);
          record({ event: "retrieved", agent: payload.agent.id, bytes: context.bytes_used, chunking: config.chunking ?? "unit", paths: [...new Set(context.parts.map((part) => part.path))], omissions: context.omissions });
          return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: "text", text }],
            source: { kind: "code-memory", snapshot_id: context.snapshot_id, form: "snapshot", sections: [{ name: "cm-source-context", text }] } })] };
        }
        return decision;
      });
    }
    });
    return;
  }
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
