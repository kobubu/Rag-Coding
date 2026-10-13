import assert from "node:assert/strict";
import test from "node:test";
import { sumUsage } from "../scripts/harness_ab.js";

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
