import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isMain } from "./lib.js";

type Run = { task: string; repetition: number; arm: "none" | "exact" | "ann"; task_success: boolean; accounting_complete: boolean; search_mode_verified: boolean; duration_ms: number; model_calls: number; usage: Record<string, number> } & Record<string, any>;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
export function summarizeAnnAB(runs: Run[]) {
  if (!runs.length || runs.some(run => !run.accounting_complete || !run.search_mode_verified)) throw Error("Cannot summarize incomplete provider/mode accounting");
  const unique = new Set(runs.map(run => [run.task, run.repetition, run.arm].join("/")));
  if (unique.size !== runs.length) throw Error("Repeated run identity");
  const groups = (["none", "exact", "ann"] as const).map(arm => {
    const selected = runs.filter(run => run.arm === arm);if (!selected.length) throw Error("Missing arm");
    const sum = (key: string) => selected.reduce((total, run) => total + run.usage[key]!, 0);
    return { arm, runs: selected.length, correct: selected.filter(run => run.task_success).length, tokens: sum("total_tokens"), input_tokens: sum("total_input"), output_tokens: sum("output"),
      uncached_input: sum("uncached_input"), cache_read: sum("cache_read"), cache_write: sum("cache_write"), estimated_usd: sum("usd_estimate"),
      model_calls: selected.reduce((total, run) => total + run.model_calls, 0), total_session_seconds: selected.reduce((total, run) => total + run.duration_ms, 0) / 1000,
      median_session_seconds: median(selected.map(run => run.duration_ms)) / 1000 };
  });
  const paired = runs.filter(run => run.arm === "exact").map(exact => {
    const none = runs.find(run => run.task === exact.task && run.repetition === exact.repetition && run.arm === "none"), ann = runs.find(run => run.task === exact.task && run.repetition === exact.repetition && run.arm === "ann");
    if (!none || !ann) throw Error("Missing matched run");
    return { task: exact.task, repetition: exact.repetition, correct: { none: none.task_success, exact: exact.task_success, ann: ann.task_success },
      tokens: { none: none.usage.total_tokens!, exact: exact.usage.total_tokens!, ann: ann.usage.total_tokens! },
      estimated_usd: { none: none.usage.usd_estimate!, exact: exact.usage.usd_estimate!, ann: ann.usage.usd_estimate! },
      initial_context_equal: exact.initial_retrieval?.context_sha256 === ann.initial_retrieval?.context_sha256,
      ann_vs_exact_tokens_percent: (ann.usage.total_tokens! / exact.usage.total_tokens! - 1) * 100,
      ann_vs_exact_price_percent: (ann.usage.usd_estimate! / exact.usage.usd_estimate! - 1) * 100 };
  });
  if (groups.some(group => group.runs !== paired.length)) throw Error("Unequal matched arm sizes");
  const comparisons = ([["exact", "none"], ["ann", "none"], ["ann", "exact"]] as const).map(([candidate, reference]) => {
    const a = groups.find(group => group.arm === candidate)!, b = groups.find(group => group.arm === reference)!;
    return { candidate, reference, tokens_percent: (a.tokens / b.tokens - 1) * 100, price_percent: (a.estimated_usd / b.estimated_usd - 1) * 100,
      session_time_percent: (a.total_session_seconds / b.total_session_seconds - 1) * 100, quality_delta_pp: (a.correct / a.runs - b.correct / b.runs) * 100,
      matched_token_wins: paired.filter(pair => pair.tokens[candidate] < pair.tokens[reference]).length,
      matched_price_wins: paired.filter(pair => pair.estimated_usd[candidate] < pair.estimated_usd[reference]).length };
  });
  return { groups, comparisons, paired, all_initial_contexts_equal: paired.every(pair => pair.initial_context_equal), accounting_complete: true };
}

if (isMain(import.meta.url)) {
  const input = resolve(process.argv[2] ?? ""), output = resolve(process.argv[3] ?? "");
  if (!process.argv[2] || !process.argv[3] || input === output) throw Error("Supply distinct private input and public output directories");
  const read = (name: string) => JSON.parse(readFileSync(join(input, name), "utf8"));
  const raw = read("results.json"), preparation = read("preparation.json"), progress = read("progress.json"), source = read("source-proof.json");
  if (progress.state !== "complete" || progress.completed !== raw.results.length || source.original_source_changes.length || !source.measured_implementation_unchanged) throw Error("Trial/source proof is not complete");
  const summary = summarizeAnnAB(raw.results), measurements = preparation.flatMap((entry: any) => entry.comparison.measurements.map((query: any) => ({ task: entry.task, ...query })));
  const native = { queries: measurements.length, semantic_holdout_queries: raw.protocol.semantic_holdout.length, k: 24, blocks: 5,
    strict_recall_at_24: measurements.reduce((sum: number, row: any) => sum + row.strict_recall_at_24, 0) / measurements.length,
    tie_aware_recall_at_24: measurements.reduce((sum: number, row: any) => sum + row.tie_aware_recall_at_24, 0) / measurements.length,
    median_exact_ms: median(measurements.map((row: any) => row.median_exact_ms)), median_ann_ms: median(measurements.map((row: any) => row.median_ann_ms)),
    equal_graph_contexts: measurements.filter((row: any) => row.render_equal).length, measurements,
    preparation: preparation.map((entry: any) => ({ task: entry.task, baseline_pass: entry.baseline.pass, seeded_pass: entry.seeded.pass,
      preparation_ms: entry.preparation_ms, vectors: entry.vectors, ann_build: entry.built, initial_context_equal: entry.comparison.measurements[0].render_equal })) };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "results.json"), JSON.stringify({ format: "cm-hnsw-model-results-1", protocol: raw.protocol, summary, native, source_proof: source, estimated_total_usd: raw.estimated_cost_usd, runs: raw.results }, null, 2));
  console.log(JSON.stringify({ summary, native: { ...native, measurements: undefined, preparation: undefined } }));
}
