import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { hash } from "../src/code-memory/source.js";
import { pathToFileURL } from "node:url";

export function summarizeOptimization(root: string) {
  const data = JSON.parse(readFileSync(join(root, "results.json"), "utf8"));
  const protocol = data.protocol;
  const progress = JSON.parse(readFileSync(join(root, "progress.json"), "utf8"));
  assert.equal(progress.state, "complete", "Optimization runner has not completed");
  const expected = progress.planned;
  assert.equal(protocol.repetitions * protocol.arms.length * new Set(data.results.map((run: { task: string }) => run.task)).size, expected);
  assert.equal(data.results.length, expected, "Optimization series is incomplete");
  const corpus = JSON.parse(readFileSync(join(root, "corpus-manifest.json"), "utf8"));
  const original = new Set([...corpus.files.map((file: { path: string }) => file.path), "package.json", "AGENTS.md"]);
  const files = (directory: string, base = directory): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) return [relative(base, path).replaceAll("\\", "/")];
    return entry.isDirectory() ? files(path, base) : [relative(base, path).replaceAll("\\", "/")];
  });
  let maxRequestInputTokens = 0;
  const audited = data.results.map((run: Record<string, any>) => {
    const meter = JSON.parse(readFileSync(join(root, "runs", run.run_id, "meter.json"), "utf8"));
    assert(run.accounting_complete && meter.calls.every((call: Record<string, any>, i: number) => call.call === i + 1 && call.usage && call.finish), "Incomplete provider usage");
    assert.equal(run.cm_active, run.arm !== "none");
    for (const call of meter.calls) maxRequestInputTokens = Math.max(maxRequestInputTokens, call.usage.inputTokens + (call.usage.cacheReadTokens ?? 0) + (call.usage.cacheWriteTokens ?? 0));
    const additional = files(join(root, "workspaces", run.run_id)).filter(path => !original.has(path));
    const scope = [...new Set([...run.scope_changes, ...additional])];
    const stderr = readFileSync(join(root, "runs", run.run_id, "stderr.txt"), "utf8");
    assert(!stderr.includes("entry did not activate"));
    const behavior = run.behavioral_success && scope.length === 0;
    const optimization = run.optimization_success && scope.length === 0;
    return { ...run, audited_scope_changes: scope, audited_behavioral_success: behavior, audited_optimization_success: optimization };
  });
  const groups = protocol.arms.map((arm: string) => {
    const runs = audited.filter((run: Record<string, any>) => run.arm === arm);
    const sum = (fn: (run: Record<string, any>) => number) => runs.reduce((total: number, run: Record<string, any>) => total + fn(run), 0);
    const successful = sum(run => Number(run.audited_optimization_success));
    return { arm, runs: runs.length, behavioral_successes: sum(run => Number(run.audited_behavioral_success)), optimization_successes: successful,
      model_calls: sum(run => run.model_calls), project_checks_calls: sum(run => run.tool_calls.project_checks ?? 0),
      total_tokens: sum(run => run.usage.total_tokens), usd_estimate: sum(run => run.usage.usd_estimate),
      mean_seconds: sum(run => run.duration_ms) / runs.length / 1000, missing_usage: sum(run => run.usage.missing_usage),
      tokens_per_successful_optimization: successful ? sum(run => run.usage.total_tokens) / successful : null,
      tasks: ["horizontal", "union"].map(task => {
        const members = runs.filter((run: Record<string, any>) => run.task === task);
        const correct = members.filter((run: Record<string, any>) => run.audited_behavioral_success && run.quality.performance);
        const ratios = correct.map((run: Record<string, any>) => run.quality.performance.real.speedup).sort((a: number, b: number) => a - b);
        return { task, runs: members.length, behavior: members.filter((run: Record<string, any>) => run.audited_behavioral_success).length,
          useful: members.filter((run: Record<string, any>) => run.audited_optimization_success).length, median_correct_cpu_speedup: ratios.length ? ratios[ratios.length >>> 1] : null };
      }) };
  });
  const baseline = groups.find((group: Record<string, any>) => group.arm === "none");
  const comparisons = groups.filter((group: Record<string, any>) => group.arm !== "none").map((group: Record<string, any>) => ({ arm: group.arm,
    token_saving_pct: 100 * (1 - group.total_tokens / baseline.total_tokens), price_saving_pct: 100 * (1 - group.usd_estimate / baseline.usd_estimate),
    behavioral_delta: group.behavioral_successes - baseline.behavioral_successes, useful_optimization_delta: group.optimization_successes - baseline.optimization_successes }));
  const proof = JSON.parse(readFileSync(join(root, "source-proof.json"), "utf8"));
  assert(proof.original_source_changes.length === 0 && proof.measured_implementation_unchanged);
  assert(maxRequestInputTokens <= 272000, "High-context pricing requires a separate per-request calculation");
  const summary = { status: "complete", accounting_complete: true, max_request_input_tokens: maxRequestInputTokens, groups, comparisons, total_runs: audited.length,
    source_proof: proof, limitations: ["Two related optimization targets in one project, three repeats", "AST scope enrichment differs from whole units", "Local target CPU, not whole-game/phone FPS", "Price estimate, not billing export"],
    audit: audited.map((run: Record<string, any>) => ({ run_id: run.run_id, arm: run.arm, scope_changes: run.audited_scope_changes, behavior: run.audited_behavioral_success, useful: run.audited_optimization_success })) };
  writeFileSync(join(root, "audited-results.json"), JSON.stringify({ ...data, results: audited }, null, 2));
  writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2));
  const safe = { protocol: { ...protocol, source_project: "Local Geo Dash checkout", implementations: protocol.implementations.filter((item: { path: string }) => !item.path.startsWith("dist/")) }, summary,
    indexing: JSON.parse(readFileSync(join(root, "indexing.json"), "utf8")),
    retrieval_preview: JSON.parse(readFileSync(join(root, "retrieval-preview.json"), "utf8")).map(({ parts, ...item }: Record<string, any>) => item),
    results: audited.map((run: Record<string, any>) => ({ run_id: run.run_id, task: run.task, repetition: run.repetition, arm: run.arm,
      behavior: run.audited_behavioral_success, useful_optimization: run.audited_optimization_success, patch_changed: run.patch_changed,
      exit_code: run.exit_code, duration_ms: run.duration_ms, model_calls: run.model_calls, usage: run.usage, tool_calls: run.tool_calls,
      scope_changes: run.audited_scope_changes, checks: { passed: run.quality.behavior?.passed ?? 0, total: run.quality.behavior?.total ?? 0,
        failed_check_ids: (run.quality.behavior?.failures ?? []).map((failure: { check: string }) => failure.check) },
      performance: run.quality.performance ?? null, target_sha256: run.quality.target_sha256 ?? null })) };
  return { summary, safe };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(summarizeOptimization(resolve(process.argv[2]!)).summary));
}
