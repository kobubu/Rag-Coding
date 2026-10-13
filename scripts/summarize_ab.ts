import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type ABRecord = { case_id: string; repetition: number; arm: "A" | "B"; task_success: boolean; exit_code: number | null;
  duration_ms: number; model_calls: number; cm_tool_calls: number;
  usage: { total_tokens: number; total_input: number; output: number; uncached_input: number; cache_read: number; cache_write: number; missing_usage: number; usd_estimate: number } };

export function summarizeAB(records: ABRecord[]) {
  const groups = (["A", "B"] as const).map((arm) => {
    const runs = records.filter((run) => run.arm === arm);
    const sum = (value: (run: ABRecord) => number) => runs.reduce((total, run) => total + value(run), 0);
    const successful = runs.filter((run) => run.task_success).length;
    return { arm, runs: runs.length, successful, runtime_errors: runs.filter((run) => run.exit_code !== 0).length,
      missing_usage: sum((run) => run.usage.missing_usage), model_calls: sum((run) => run.model_calls), cm_tool_calls: sum((run) => run.cm_tool_calls),
      total_tokens: sum((run) => run.usage.total_tokens), total_input: sum((run) => run.usage.total_input), output: sum((run) => run.usage.output),
      uncached_input: sum((run) => run.usage.uncached_input), cache_read: sum((run) => run.usage.cache_read), cache_write: sum((run) => run.usage.cache_write),
      usd_estimate: sum((run) => run.usage.usd_estimate), mean_seconds: sum((run) => run.duration_ms) / runs.length / 1000,
      tokens_per_success: successful ? sum((run) => run.usage.total_tokens) / successful : null };
  });
  const cases = [...new Set(records.map((run) => run.case_id))];
  const paired = cases.map((id) => {
    const a = records.filter((run) => run.case_id === id && run.arm === "A");
    const b = records.filter((run) => run.case_id === id && run.arm === "B");
    if (!a.length || a.length !== b.length || new Set(a.map((run) => run.repetition)).size !== a.length ||
      new Set(b.map((run) => run.repetition)).size !== b.length || a.some((run) => !b.some((other) => run.repetition === other.repetition))) throw new Error("Unpaired or duplicate experiment runs");
    const tokensA = a.reduce((total, run) => total + run.usage.total_tokens, 0);
    const tokensB = b.reduce((total, run) => total + run.usage.total_tokens, 0);
    return { case_id: id, repetitions: a.length, A_tokens: tokensA, B_tokens: tokensB, saving_pct: 100 * (1 - tokensB / tokensA),
      A_success: a.filter((run) => run.task_success).length, B_success: b.filter((run) => run.task_success).length };
  });
  if (!paired.length || groups.some((group) => group.runs === 0)) throw new Error("Both arms need completed runs");
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const bootstrap: number[] = [];
  for (let iteration = 0; iteration < 20000; iteration++) {
    let a = 0, b = 0;
    for (let index = 0; index < paired.length; index++) { const sample = paired[Math.floor(random() * paired.length)]!; a += sample.A_tokens; b += sample.B_tokens; }
    bootstrap.push(100 * (1 - b / a));
  }
  bootstrap.sort((a, b) => a - b);
  const baseline = groups[0]!, candidate = groups[1]!;
  const accountingComplete = records.every((run) => run.usage.missing_usage === 0 && run.model_calls > 0);
  return { groups, paired_cases: paired, accounting_complete: accountingComplete,
    token_saving_pct: 100 * (1 - candidate.total_tokens / baseline.total_tokens),
    cost_saving_pct: 100 * (1 - candidate.usd_estimate / baseline.usd_estimate),
    quality_delta_pp: 100 * (candidate.successful / candidate.runs - baseline.successful / baseline.runs),
    exploratory_task_bootstrap_95_pct: [bootstrap[500], bootstrap[19499]],
    limitations: [`${paired.length} task types from one project; repeated tasks are not independent`, "Seeded regressions; no historical production bug claim",
      "Same conditional navigation instruction in both arms; availability alone is not tested", "USD is calculated from provider usage, not a billing export"] };
}

const invokedFile = globalThis.process?.argv[1];
if (invokedFile && pathToFileURL(resolve(invokedFile)).href === import.meta.url) {
  const input = process.argv[2], output = process.argv[3];
  if (!input || !output) throw new Error("Usage: summarize_ab results.json summary.json");
  const data = JSON.parse(readFileSync(resolve(input), "utf8"));
  const result = summarizeAB(data.results);
  writeFileSync(resolve(output), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
