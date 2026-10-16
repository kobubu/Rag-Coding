import assert from "node:assert/strict";
import test from "node:test";
import { hookOutput, GUIDANCE } from "../src/hooks/context.js";
import { renderContext } from "../src/code-memory/retrieve.js";
import { codexUsage } from "../scripts/native_ab.js";

test("hook output is a UserPromptSubmit additionalContext and does not claim a registered read", () => {
  const context = { snapshot_id: "file:x", channels: [], bytes_used: 4, omissions: 0, complete: false as const,
    parts: [{ path: "a.js", reason: "match" as const, whole: true as const, text: "x=1\n", span: { file_version_id: "blob:x", start_byte: 0, end_byte: 4, line_start: 1, line_end: 1 } }] };
  const parsed = JSON.parse(hookOutput(renderContext(context, false)));
  assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert(parsed.hookSpecificOutput.additionalContext.startsWith(GUIDANCE));
  assert(parsed.hookSpecificOutput.additionalContext.includes("a.js:1-1 (whole file)"));
  assert(!renderContext(context, false).includes("registered as read"));assert(renderContext(context).includes("registered as read"));
});

test("Codex usage separates uncached input from cache reads and writes and rejects unreconciled totals", () => {
  const usage = codexUsage([{ type: "turn.completed", usage: { input_tokens: 21527, cached_input_tokens: 10684, cache_write_input_tokens: 10837, output_tokens: 133 } }, { type: "turn.started" }]);
  assert.equal(usage.uncached_input, 6);assert.equal(usage.total_tokens, 21660);assert.equal(usage.turns, 1);
  assert(Math.abs(usage.usd_estimate - (6 * .10 + 10684 * .01 + 10837 * .125 + 133 * .5) / 1e6) < 1e-12);
  assert.throws(() => codexUsage([{ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 5 } }]), /reconcile/);
});
