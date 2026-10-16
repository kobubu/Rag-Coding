import assert from "node:assert/strict";
import test from "node:test";
import { hookOutput, GUIDANCE } from "../src/hooks/context.js";
import { renderContext } from "../src/code-memory/retrieve.js";
import { codexUsage } from "../scripts/native_ab.js";
import { ask, daemonAddress, ping } from "../src/hooks/client.js";
import { agentOptions } from "../src/local-agent/config.js";
import { buildIndex } from "../src/code-memory/indexer.js";
import { ROOT } from "../scripts/lib.js";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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

test("hook daemon answers from a warm index over an owner-only socket and removes the socket on exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-daemon-"));
  writeFileSync(join(root, "rules.js"), "const LIMIT=3;\nexport function quota(n){return Math.max(0,LIMIT-n);}\n");
  mkdirSync(join(root, ".code-memory"));writeFileSync(join(root, ".code-memory/index.json"), JSON.stringify(buildIndex(root)));
  const args = ["--project", root, "--retrieval-policy", "adaptive", "--memory-dir", join(root, ".code-memory/live")];
  const child = spawn(process.execPath, [join(ROOT, "dist/src/hooks/daemon_cli.js"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const started = await new Promise<{ address: string }>((done, fail) => { child.stdout.once("data", data => done(JSON.parse(String(data)))); child.once("exit", code => fail(new Error("daemon exited " + code))); });
    assert.equal(started.address, daemonAddress(agentOptions(args)));
    if (process.platform !== "win32") assert.equal(statSync(dirname(started.address)).mode & 0o077, 0);
    assert.deepEqual(Object.keys(await ping(started.address) as object).sort(), ["ok", "pid"]);
    const reply = await ask(started.address, "Change `quota` in `rules.js`");
    assert(reply.text.includes("rules.js:1-2 (whole file)") && !reply.text.includes("registered as read"));
    assert.equal(reply.paths[0], "rules.js");
    child.kill("SIGTERM");await new Promise(done => child.once("exit", done));
    if (process.platform !== "win32") assert(!existsSync(started.address));
  } finally { child.kill("SIGKILL"); }
});
