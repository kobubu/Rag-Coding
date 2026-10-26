import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { buildIndex } from "../src/code-memory/indexer.js";
import { validateIndex } from "../src/code-memory/store.js";
import { mountHarnessPlugin } from "./harness_runtime.js";
import { ROOT, writeJson } from "./lib.js";

const index = validateIndex(buildIndex(ROOT));
const target = join(ROOT, ".artifacts/cm-smoke-index.json");
writeJson(target, index);
const runtime = await mountHarnessPlugin({ projectRoot: ROOT, indexPath: target, mode: "legacy" });
try {
  const names = runtime.ctx.tools.schemas().map((tool) => tool.name).sort();
  assert.deepEqual(names, ["cm_code_search", "cm_context_get", "cm_graph_expand", "cm_symbol_search"]);
  const symbols = await runtime.call("cm_symbol_search", { query: "collectBatches" });
  assert.equal(symbols.isError, false);
  const code = await runtime.call("cm_code_search", { query: "collectBatches" });
  assert.equal(code.isError, false);
  const unit = index.units.find((item) => item.name === "flush" && item.path === "fixtures/batching.ts");
  assert(unit);
  const context = await runtime.call("cm_context_get", { id: unit.id, snapshot_id: index.snapshot_id });
  assert.equal(context.isError, false);
  assert(context.content.some((item) => item.type === "text" && item.text.includes("collectBatches")));
  const graph = await runtime.call("cm_graph_expand", { id: unit.id, snapshot_id: index.snapshot_id, predicate: "captures" });
  assert.equal(graph.isError, false);
  const missing = await runtime.call("cm_context_get", { id: unit.id, snapshot_id: "wrong-snapshot" });
  assert.equal(missing.isError, true);
  await runtime.pluginFiber.dispose();
  assert.equal(runtime.ctx.tools.schemas().length, 0);
  const proof = { status: "PASS", harness_tools_version: "0.2.0-rc.2", cordis_version: "4.0.4", runtime: process.version,
    boundary: "Real Cordis + Harness ToolRuntime registry/dispatch; no live model or Web UI", tools: names,
    files: index.files.length, symbols: index.symbols.length, units: index.units.length, edges: index.relations.length,
    snapshot_id: index.snapshot_id, source_executed: false, llm_calls: false, unload: "PASS", stale_snapshot: "PASS" };
  writeJson(join(ROOT, ".artifacts/plugin-smoke.json"), proof);
  console.log(JSON.stringify(proof));
} finally { await runtime.close(); }

const compactRoot = await mkdtemp(join(tmpdir(), "cm-compact-smoke-"));
const compact = await mountHarnessPlugin({ projectRoot: compactRoot, autoUpdate: true });
try {
  const source = 'export const greeting = "Привет 😀";\r\n';
  await writeFile(join(compactRoot, "greeting.ts"), source);
  assert.deepEqual(compact.ctx.tools.schemas().map(tool => tool.name), ["cm_retrieve_context"]);
  let observed = 0;
  compact.ctx.on("fs/observed", () => { observed++; });
  const result = await compact.call("cm_retrieve_context", { query: "Change greeting.ts" });
  assert.equal(result.isError, false);
  assert(result.content.some(part => part.type === "text" && part.text.includes(source)));
  const messages = [createUserMessage({ source: { kind: "user" }, content: [{ type: "text", text: "Change greeting.ts" }] })];
  const decision = await compact.step({ id: "compact-smoke" } as Agent, messages);
  assert.equal(decision.kind, "enter");
  if (decision.kind === "enter") assert.equal(decision.messages.at(-1)?.source.kind, "code-memory");
  assert.equal(observed, 2);
  assert((await compact.call("cm_retrieve_context", { query: "Change greeting.ts", max_bytes: 0 })).isError);
  await compact.pluginFiber.dispose();
  assert.equal(compact.ctx.tools.schemas().length, 0);
  const proof = { status: "PASS", mode: "compact", runtime: process.version, filesystem: "Harness LocalFileSystem",
    tool_dispatch: "PASS", automatic_context: "PASS", observed_files: observed, invalid_budget: "PASS", unload: "PASS", llm_calls: false };
  writeJson(join(ROOT, ".artifacts/plugin-compact-smoke.json"), proof);
  console.log(JSON.stringify(proof));
} finally { await compact.close(); await rm(compactRoot, { recursive: true, force: true }); }
