import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { LocalVectors } from "../code-memory/vector.js";
import { retrieveContext, renderContext } from "../code-memory/retrieve.js";
import { CMError, hash } from "../code-memory/source.js";
import { codeSearch, contextGet, graphExpand, symbolSearch } from "../code-memory/query.js";
import { CMStore } from "../code-memory/store.js";
import { LiveMemory } from "../code-memory/live.js";
import { directFileContext } from "../code-memory/direct.js";
export const name = "code-memory";
export const inject = ["tools"];
// Whole files already placed in the conversation by CM. Every copy is re-sent with each later model call, so the first
// re-read of the same unchanged bytes gets a pointer instead; a second re-read (or any changed file) is served normally.
export async function rereadPointer(delivered, root, tool, args) {
    const file = args?.file_path;
    if (tool !== "read" || typeof file !== "string")
        return;
    const hostPath = resolve(root, file), shown = delivered.get(hostPath);
    if (!shown)
        return;
    delivered.delete(hostPath);
    let current;
    try {
        current = await readFile(hostPath);
    }
    catch {
        return;
    }
    if ("blob:" + hash(current) !== shown.version)
        return;
    return { path: shown.path, bytes: current.length,
        text: `${shown.path} is unchanged since the CM context above, which shows it whole (lines 1-${shown.lines}). Use that text; the file is already registered as read for edit. Read again only if you need it repeated.` };
}
export function apply(ctx, config = {}) {
    const root = resolve(config.projectRoot ?? process.env.CM_PROJECT_ROOT ?? process.cwd());
    const store = new CMStore(root, resolve(root, config.indexPath ?? process.env.CM_INDEX_PATH ?? ".code-memory/index.json"));
    const mode = config.mode ?? "compact";
    if (mode !== "compact" && mode !== "legacy")
        throw new CMError("invalid_argument", "mode must be compact or legacy");
    const autoContext = config.autoContext ?? true;
    if (mode === "compact") {
        ctx.inject(["tools", "systemPrompt", "fs"], (ctx) => {
            const diagnostics = [];
            const record = (value) => { if (config.diagnosticsPath) {
                diagnostics.push({ at_ms: Date.now(), ...value });
                writeFileSync(config.diagnosticsPath, JSON.stringify(diagnostics));
            } };
            record({ event: "compact_registered", mode, autoContext, search_mode: config.searchMode ?? "exact" });
            const vectors = new LocalVectors({ directory: resolve(root, config.vectorsPath ?? ".code-memory/vectors"),
                modelCache: resolve(root, config.modelCache ?? ".code-memory/models"), chunking: config.chunking ?? "unit", searchMode: config.searchMode ?? "exact" });
            ctx.effect(() => () => vectors.close(), "CM local vector cleanup");
            const live = config.autoUpdate ? new LiveMemory({ projectRoot: root, directory: resolve(root, config.memoryDirectory ?? ".code-memory/live"),
                modelCache: vectors.config.modelCache, baseIndex: store.indexPath, baseVectors: vectors.config.directory, chunking: config.chunking ?? "unit", searchMode: config.searchMode ?? "exact",
                ...(config.embeddingCache ? { embeddingCache: config.embeddingCache } : {}), ...(config.sourceScope ? { sourceScope: config.sourceScope } : {}) }) : undefined;
            if (live) {
                if (config.backgroundUpdate)
                    live.startWatching();
                ctx.effect(() => () => live.close(), "CM live generation cleanup");
            }
            const observe = async (context, signal, actor) => {
                for (const path of new Set(context.parts.map((part) => part.path))) {
                    const hostPath = resolve(root, path);
                    const processPath = ctx.fs.processPathFromHostPath(hostPath);
                    if (processPath === undefined)
                        throw new CMError("unsupported_filesystem", "CM source is not accessible in this Harness filesystem");
                    const target = await ctx.fs.resolve(processPath, { signal });
                    const before = await ctx.fs.stat(target, signal);
                    if (!before || before.type !== "file")
                        throw new CMError("index_outdated", "CM file is unavailable");
                    const actual = await ctx.fs.readText(target, signal);
                    const after = await ctx.fs.stat(target, signal);
                    const versions = new Set(context.parts.filter(part => part.path === path).map(part => part.span.file_version_id));
                    if (before.version !== after?.version || versions.size !== 1 || !versions.has("blob:" + hash(Buffer.from(actual, "utf8")))) {
                        throw new CMError("index_outdated", "CM source changed during context observation");
                    }
                    ctx.emit("fs/observed", target, { kind: "present", version: after.version }, actor);
                }
            };
            // Whole files already placed in the conversation. Every copy is re-sent with each later model call, so the first re-read
            // of the same unchanged bytes gets a pointer instead; a second re-read is served normally.
            const delivered = new Map();
            const remember = (context) => {
                for (const part of context.parts)
                    if (part.whole)
                        delivered.set(resolve(root, part.path), { path: part.path, version: part.span.file_version_id, lines: part.span.line_end });
            };
            ctx.on("tools/post-execute", async (exec, result, next) => {
                if (result.isError)
                    return next();
                const pointer = await rereadPointer(delivered, root, exec.name, exec.arguments);
                if (!pointer)
                    return next();
                record({ event: "read_deduplicated", path: pointer.path, bytes: pointer.bytes });
                return { kind: "accept", content: [{ type: "text", text: pointer.text }] };
            });
            const retrieve = async (query, budget, signal, actor, detail = "focused") => {
                if ((config.retrievalPolicy ?? "adaptive") === "adaptive" && detail === "focused") {
                    const direct = await directFileContext(root, query, budget ?? config.maxContextBytes ?? 6000, signal, config.sourceScope);
                    if (direct) {
                        await observe(direct, signal, actor);
                        return direct;
                    }
                }
                const action = async (index, currentVectors) => {
                    const context = await retrieveContext(index, currentVectors, query, budget ?? config.maxContextBytes ?? 6000, signal, { policy: config.retrievalPolicy ?? "adaptive", detail });
                    await observe(context, signal, actor);
                    return context;
                };
                if (live)
                    return live.use(signal, undefined, action);
                return action(await store.load(signal), vectors);
            };
            ctx.tools.register(defineTool({ name: "cm_retrieve_context", description: "Get current small self-contained named files or compact compiler-bound context. Discovery uses local vector search. Version-checked and observed for edit. Partial; expand or read when needed.",
                parameters: { query: { type: "string", required: true }, max_bytes: { type: "integer" }, ...((config.retrievalPolicy ?? "adaptive") !== "hybrid" ? { detail: { type: "string", enum: ["focused", "expanded"] } } : {}) },
                output: { schema: { type: "object", additionalProperties: true }, render: (_args, value) => [{ type: "text", text: renderContext(value) }] },
                async execute(args, exec) { const context = await retrieve(args.query, args.max_bytes, exec.signal, exec, args.detail ?? "focused"); remember(context); return context; }, }));
            ctx.systemPrompt.section({ name: "cm-context-guidance", order: 1350,
                text: "CM source context is already read through this filesystem and version-observed for guarded edit. Files marked (whole file) are complete: do not re-read them. Listed call sites come from the compiler graph, so a call-site search is unnecessary. When the fix touches one or two places in shown code, edit directly without a separate plan, but first reason through the behavior the shown code must keep (edge cases, ordering, ties, return shape); use cm_retrieve_context or read only for code that is not shown." });
            if (autoContext) {
                ctx.on("agent/pre-step", async (payload, next) => {
                    const decision = await next();
                    record({ event: "pre_step", agent: payload.agent.id, kind: decision.kind, messages: decision.kind === "enter" ? decision.messages.length : 0 });
                    if (decision.kind !== "enter")
                        return decision;
                    const query = payload.messages.filter((message) => message.source.kind === "user").flatMap((message) => message.content.filter((part) => part.type === "text").map((part) => part.text)).join("\n");
                    if (query.trim()) {
                        const started = performance.now();
                        const context = await retrieve(query.slice(0, 16000), undefined, payload.signal, payload);
                        const text = renderContext(context);
                        remember(context);
                        record({ event: "retrieved", duration_ms: performance.now() - started, agent: payload.agent.id, bytes: context.bytes_used, chunking: config.chunking ?? "unit", search_mode: config.searchMode ?? "exact", context_sha256: hash(Buffer.from(text, "utf8")), paths: [...new Set(context.parts.map((part) => part.path))], omissions: context.omissions, retrieval: context.retrieval });
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
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
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
