import assert from "node:assert/strict";
import test from "node:test";
import { sumUsage } from "../scripts/harness_ab.js";
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
