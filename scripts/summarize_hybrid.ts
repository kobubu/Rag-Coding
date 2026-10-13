import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { summarizeAB } from "./summarize_ab.js";
import type { ABRecord } from "./summarize_ab.js";
const root = resolve(process.argv[2] ?? "");
const data = JSON.parse(readFileSync(join(root, "results.json"), "utf8")) as { results: (ABRecord & { run_id: string })[] };
const summary = summarizeAB(data.results);
const activation = data.results.map((run) => {
  const meter = JSON.parse(readFileSync(join(root, "runs", run.run_id, "meter.json"), "utf8")) as {
    attempts: number; calls: { call: number; usage: unknown; finish: string | null; cm_tools: string[]; cm_context_present: boolean }[] };
  assert.equal(meter.attempts, meter.calls.length, "A provider attempt has no settled usage record");
  assert(meter.calls.every((call, position) => call.call === position + 1 && call.usage !== null && call.finish !== null), "Usage or finish event is missing");
  const first = meter.calls[0];
  assert(first, "Every run needs provider usage");
  const present = first.cm_context_present && first.cm_tools.includes("cm_retrieve_context");
  assert.equal(present, run.arm === "B", "CM activation/context leaked or is absent");
  const text = readFileSync(join(root, "runs", run.run_id, "stderr.txt"), "utf8");
  assert(!text.includes("entry did not activate"), "A plugin did not activate");
  if (run.exit_code !== 0) assert(text.includes("AB model-call limit reached") && meter.calls.length === 12,
    "An unexpected runtime failure may have lost in-flight usage");
  const trace = run.arm === "B" ? JSON.parse(readFileSync(join(root, "runs", run.run_id, "retrieval.json"), "utf8")) as { event: string; bytes?: number }[] : [];
  const retrieval = trace.find((event) => event.event === "retrieved");
  if (run.arm === "B") assert(retrieval && retrieval.bytes! > 0, "Automatic context is empty");
  const events = readFileSync(join(root, "runs", run.run_id, "stdout.jsonl"), "utf8").split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as { type: string; result?: string });
  const artifactExposure = events.some((event) => event.type === "tool_result" && String(event.result).includes(".code-memory"));
  return { run_id: run.run_id, arm: run.arm, cm_active: present, auto_context_bytes: retrieval?.bytes ?? 0, artifact_exposure_in_tool_results: artifactExposure };
});
const candidate = summary.groups.find((group) => group.arm === "B")!;
const baseline = summary.groups.find((group) => group.arm === "A")!;
const proof = { ...summary, activation, local_embedding_api_cost_usd: 0,
  goal_achieved_in_this_pilot: summary.accounting_complete && summary.token_saving_pct > 0 && summary.cost_saving_pct > 0 && candidate.successful / candidate.runs >= baseline.successful / baseline.runs };
writeFileSync(join(root, "summary.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof));
