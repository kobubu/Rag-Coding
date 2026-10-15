import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Summarizes an efficiency A/B results file: per-arm totals, medians and matched task/repetition pairs.
type Run = { task: string; repetition: number; arm: string; task_success: boolean; model_calls: number; duration_ms: number; end_to_end_ms: number;
  usage: { total_tokens: number; usd_estimate: number; cache_read: number; cache_write: number; output: number; uncached_input: number }; tool_calls: Record<string, number>; mode_verified: boolean; accounting_complete: boolean };
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error("Usage: summarize_efficiency results.json summary.json");
const data = JSON.parse(readFileSync(resolve(input), "utf8")) as { protocol: { arms: string[] }; estimated_cost_usd: number; results: Run[] };
const runs = data.results, arms = data.protocol.arms;
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; };
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const reads = (run: Run) => sum(["read", "grep", "glob"].map(tool => run.tool_calls[tool] ?? 0));
const arm = (name: string) => {
  const list = runs.filter(run => run.arm === name);
  return { runs: list.length, successes: list.filter(run => run.task_success).length, total_tokens: sum(list.map(run => run.usage.total_tokens)), usd_estimate: sum(list.map(run => run.usage.usd_estimate)),
    model_calls: sum(list.map(run => run.model_calls)), read_grep_glob_calls: sum(list.map(reads)), harness_seconds: sum(list.map(run => run.duration_ms)) / 1000,
    median_session_seconds: median(list.map(run => run.duration_ms)) / 1000, median_session_tokens: median(list.map(run => run.usage.total_tokens)),
    all_accounted: list.every(run => run.accounting_complete && run.mode_verified) };
};
const perArm = Object.fromEntries(arms.map(name => [name, arm(name)]));
const change = (to: string, from: string, key: "total_tokens" | "usd_estimate" | "harness_seconds" | "model_calls") => +(100 * (perArm[to]![key] / perArm[from]![key] - 1)).toFixed(1);
const pairs = (to: string, from: string) => {
  const matched = runs.filter(run => run.arm === to).map(run => [run, runs.find(other => other.arm === from && other.task === run.task && other.repetition === run.repetition)!] as const).filter(([, other]) => other);
  return { pairs: matched.length, fewer_tokens: matched.filter(([a, b]) => a.usage.total_tokens < b.usage.total_tokens).length, faster: matched.filter(([a, b]) => a.duration_ms < b.duration_ms).length,
    cheaper: matched.filter(([a, b]) => a.usage.usd_estimate < b.usage.usd_estimate).length };
};
const comparisons = arms.flatMap(to => arms.filter(from => from !== to && (to === "cm_next" || to === "cm_base" && from === "none")).map(from => ({ candidate: to, reference: from,
  tokens_pct: change(to, from, "total_tokens"), price_pct: change(to, from, "usd_estimate"), harness_time_pct: change(to, from, "harness_seconds"), model_calls_pct: change(to, from, "model_calls"), ...pairs(to, from) })));
const byTask = [...new Set(runs.map(run => run.task))].map(task => ({ task, ...Object.fromEntries(arms.map(name => {
  const list = runs.filter(run => run.task === task && run.arm === name);
  return [name, { successes: list.filter(run => run.task_success).length + "/" + list.length, tokens: sum(list.map(run => run.usage.total_tokens)), calls: sum(list.map(run => run.model_calls)), seconds: +(sum(list.map(run => run.duration_ms)) / 1000).toFixed(1) }];
})) }));
const summary = { source: input, runs: runs.length, estimated_cost_usd: data.estimated_cost_usd, arms: perArm, comparisons, by_task: byTask,
  failures: runs.filter(run => !run.task_success).map(run => ({ task: run.task, repetition: run.repetition, arm: run.arm })) };
writeFileSync(resolve(output), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ arms: perArm, comparisons }, null, 2));
