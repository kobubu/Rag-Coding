import assert from "node:assert/strict";
import { join } from "node:path";
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
