import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { mountHarnessPlugin } from "../scripts/harness_runtime.js";

const agent = (id: string) => ({ id }) as Agent;
const messages = (text: string) => [createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } })];

test("automatic context failure preserves the accepted step; explicit retrieval still reports failure", async t => {
  const root = await mkdtemp(join(tmpdir(), "cm-harness-fallback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = await mountHarnessPlugin({ projectRoot: root });
  t.after(() => runtime.close());
  const input = messages("Find the implementation of batching"), decision = { kind: "enter" as const, messages: input };
  assert.strictEqual(await runtime.step(agent("fallback"), input, undefined, decision), decision);
  const result = await runtime.call("cm_retrieve_context", { query: "Find batching" });
  assert(result.isError);
  assert.match(JSON.stringify(result.content), /index_not_ready/);
  const rejected = { kind: "reject" as const };
  assert.strictEqual(await runtime.step(agent("reject"), input, undefined, rejected), rejected);
  const abort = new AbortController(); abort.abort(new Error("cancelled by user"));
  await assert.rejects(runtime.step(agent("cancel"), input, abort.signal), /cancelled by user/);
});

test("compact context observes actual files, survives failed diagnostics, and preserves cancellation", async t => {
  const root = await mkdtemp(join(tmpdir(), "cm-harness-observe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = 'export const message = "Ж😀";\r\n';
  await writeFile(join(root, "one.ts"), source);
  const runtime = await mountHarnessPlugin({ projectRoot: root, diagnosticsPath: root });
  t.after(() => runtime.close());
  let observed = 0;
  runtime.ctx.on("fs/observed", () => { observed++; });
  assert.deepEqual(runtime.ctx.tools.schemas().map(tool => tool.name), ["cm_retrieve_context"]);
  const result = await runtime.call("cm_retrieve_context", { query: "Change one.ts" });
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result.content), /Ж😀/);
  assert.equal(observed, 1);
  const step = await runtime.step(agent("healthy"), messages("Change one.ts"));
  assert.equal(step.kind, "enter");
  if (step.kind === "enter") assert.equal(step.messages.at(-1)?.source.kind, "code-memory");
  const read = runtime.ctx.fs.readText.bind(runtime.ctx.fs);
  runtime.ctx.fs.readText = async (...args) => (await read(...args)) + "changed";
  const input = messages("Change one.ts"), decision = { kind: "enter" as const, messages: input };
  assert.strictEqual(await runtime.step(agent("stale"), input, undefined, decision), decision);
  assert.equal(observed, 2);
  assert((await runtime.call("cm_retrieve_context", { query: "Change one.ts" })).isError);
});

test("whole-file read pointers belong only to the agent that received the context", async t => {
  const root = await mkdtemp(join(tmpdir(), "cm-harness-agents-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = "export const count = 1;\n";
  await writeFile(join(root, "one.ts"), source);
  const runtime = await mountHarnessPlugin({ projectRoot: root });
  t.after(() => runtime.close());
  runtime.ctx.tools.register(defineTool({ name: "read", description: "Read fixture", parameters: { file_path: { type: "string", required: true } },
    output: { schema: { type: "string" }, render: (_args: unknown, value: string) => [{ type: "text" as const, text: value }] },
    async execute() { return await readFile(join(root, "one.ts"), "utf8"); } }));
  const first = agent("first"), second = agent("second");
  await runtime.step(first, messages("Change one.ts"));
  const other = await runtime.call("read", { file_path: "one.ts" }, undefined, second);
  assert(!JSON.stringify(other.content).includes("unchanged since"));
  const own = await runtime.call("read", { file_path: "one.ts" }, undefined, first);
  assert.match(JSON.stringify(own.content), /unchanged since/);
  const again = await runtime.call("read", { file_path: "one.ts" }, undefined, first);
  assert(!JSON.stringify(again.content).includes("unchanged since"));
  await runtime.call("cm_retrieve_context", { query: "Change one.ts" }, undefined, second);
  assert.match(JSON.stringify((await runtime.call("read", { file_path: "one.ts" }, undefined, second)).content), /unchanged since/);
  await runtime.step(first, messages("Change one.ts"));
  await runtime.ctx.serial("agent/created", { agent: first, source: "compact" });
  assert(!JSON.stringify((await runtime.call("read", { file_path: "one.ts" }, undefined, first)).content).includes("unchanged since"));
  await runtime.step(first, messages("Change one.ts"));
  await writeFile(join(root, "one.ts"), "export const count = 2;\n");
  assert.match(JSON.stringify((await runtime.call("read", { file_path: "one.ts" }, undefined, first)).content), /count = 2/);
});

test("diagnostics retain a bounded recent history and cancellation during observation is not swallowed", async t => {
  const root = await mkdtemp(join(tmpdir(), "cm-harness-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "diagnostics.json");
  await writeFile(join(root, "one.ts"), "export const count = 1;\n");
  const runtime = await mountHarnessPlugin({ projectRoot: root, diagnosticsPath: path });
  t.after(() => runtime.close());
  for (let i = 0; i < 270; i++) await runtime.step(agent(String(i)), []);
  const records = JSON.parse(await readFile(path, "utf8"));
  assert.equal(records.length, 256);
  assert.equal(records[0].agent, "14");
  assert.equal(records.at(-1).agent, "269");
  const abort = new AbortController(), read = runtime.ctx.fs.readText.bind(runtime.ctx.fs);
  let observed = 0;
  runtime.ctx.on("fs/observed", () => { observed++; });
  runtime.ctx.fs.readText = async (...args) => { const result = await read(...args); abort.abort(new Error("cancel during read")); return result; };
  await assert.rejects(runtime.step(agent("cancel"), messages("Change one.ts"), abort.signal), /cancel during read/);
  assert.equal(observed, 0);
});
