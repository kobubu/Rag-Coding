import assert from "node:assert/strict";
import test from "node:test";
import { bootProfile, sumUsage } from "../scripts/harness_ab.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { summarizeAB } from "../scripts/summarize_ab.js";

test("AB accounting includes disjoint cached tokens and preserves missing usage", () => {
  const usage = sumUsage([{ usage: { inputTokens: 3, outputTokens: 38, totalTokens: 2713, cacheWriteTokens: 2672 } },
    { usage: { inputTokens: 7, outputTokens: 11, cacheReadTokens: 200, totalTokens: 218 } }, { usage: null }]);
  assert.equal(usage.total_tokens, 2931);
  assert.equal(usage.total_input, 2882);
  assert.equal(usage.output, 49);
  assert.equal(usage.uncached_input, 10);
  assert.equal(usage.cache_read, 200);
  assert.equal(usage.cache_write, 2672);
  assert.equal(usage.missing_usage, 1);
  assert.throws(() => sumUsage([{ usage: { inputTokens: 1, outputTokens: 2, totalTokens: 100 } }]), /reconcile/);
  assert.throws(() => sumUsage([{ usage: { inputTokens: -1, outputTokens: 2 } }]), /Invalid/);
});

test("failed budget-limited coding sessions stay in token/cost totals without invalidating settled provider accounting", () => {
  const usage = sumUsage([{ usage: { inputTokens: 3, outputTokens: 7, cacheReadTokens: 20, totalTokens: 30 } }]);
  const summary = summarizeAB([
    { case_id: "fixture", repetition: 1, arm: "A", task_success: false, exit_code: 1, duration_ms: 100, model_calls: 1, cm_tool_calls: 0, usage },
    { case_id: "fixture", repetition: 1, arm: "B", task_success: true, exit_code: 0, duration_ms: 100, model_calls: 1, cm_tool_calls: 0, usage },
  ]);
  assert.equal(summary.groups[0]!.runtime_errors, 1);
  assert.equal(summary.groups[0]!.successful, 0);
  assert.equal(summary.groups[0]!.total_tokens, 30);
  assert.equal(summary.accounting_complete, true);
  assert.equal(summary.quality_delta_pp, 100);
});

test("Harness benchmark passes distinct exact/ANN modes and keeps the baseline free of CM", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ab-mode-"));
  const harness = join(root, "offline-harness.mjs");
  writeFileSync(harness, "process.stdin.resume();process.stdin.on('end',()=>process.exit(0));");
  for (const arm of ["exact", "ann", "none"] as const) {
    const result = await bootProfile({ project: root, output: root, node: process.execPath, harness,
      apiKey: "offline-test-credential", model: "offline-test-model", cmMode: "compact", ...(arm !== "none" ? { searchMode: arm } : {}) }, root, arm, "offline test", arm !== "none");
    assert.equal(result.exit_code, 0);
    const patch = JSON.parse(readFileSync(join(result.directory, "profile.patch.yml"), "utf8"));
    const plugin = patch.flatMap((entry: { insert?: { id: string; config: { searchMode?: string } }[] }) => entry.insert ?? []).find((entry: { id: string }) => entry.id === "code-memory");
    if (arm === "none") assert.equal(plugin, undefined);
    else assert.equal(plugin.config.searchMode, arm);
  }
});
