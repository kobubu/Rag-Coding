import assert from "node:assert/strict";
import { test } from "node:test";
import { providerTotals } from "../scripts/client_gateway.js";
import { summarizeClientRuns } from "../scripts/summarize_client_ab.js";

test("native provider accounting does not double-count cache categories", () => {
  const totals = providerTotals([
    { run: "a", endpoint: "v1/responses", status: 200, elapsed_ms: 1, usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 } } },
    { run: "a", endpoint: "v1/models", status: 200, elapsed_ms: 1, usage: null },
    { run: "a", endpoint: "v1/responses", status: 502, elapsed_ms: 1, usage: null }
  ]);
  assert.equal(totals.input, 1000);
  assert.equal(totals.total, 1100);
  assert.equal(totals.cache_read, 600);
  assert.equal(totals.cache_write, 200);
  assert.equal(totals.missing, 1);
  assert(Math.abs(totals.usd_estimate - .000101) < 1e-12);
});

test("native A/B counts failed runs in cost and pairs by task and repetition", () => {
  const make = (task: string, rep: number, arm: string, success: boolean, tokens: number, seconds: number) => ({ client: "codex", task, category: "fixture", rep, arm, run: `${task}-${rep}-${arm}`, elapsed_ms: seconds * 1000, setup_ms: 100, grade_ms: 100, success, completed: true, timed_out: false, regressions: true, cm_calls: arm === "cm" ? 1 : 0, usage: { total: tokens, input: tokens - 1, output: 1, cache_read: 0, cache_write: 0, missing: 0, usd_estimate: .001 }, native_usage: {}, quality: { pass: success }, scope_changes: [], calls: [] });
  const runs = [make("two", 1, "cm", false, 200, 20), make("one", 1, "none", true, 100, 10), make("two", 1, "none", false, 100, 10), make("one", 1, "cm", true, 50, 5)];
  const summary = summarizeClientRuns(runs);
  assert.equal(summary.none.total_tokens, 200);
  assert.equal(summary.cm.total_tokens, 250);
  assert.equal(summary.cm.passed, 1);
  assert.equal(summary.cm.amortized_tokens_per_pass, 250);
  assert.equal(summary.cm.median_agent_seconds, 12.5);
  assert.equal(summary.differences.pairs, 2);
  assert.equal(summary.differences.token_change_pct, 25);
  assert.equal(summary.differences.paired_token_wins, 1);
  assert.equal(summary.differences.paired_quality_losses, 0);
  assert.equal(summary.task_cluster_bootstrap_95pct.tokens.length, 2);
});
