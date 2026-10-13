import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildVectors } from "../src/code-memory/vector.js";
import type { ChunkingStrategy } from "../src/code-memory/chunks.js";
import type { CMIndex } from "../src/code-memory/types.js";
import { hash } from "../src/code-memory/source.js";
import { bootProfile, createCorpus, sumUsage } from "./harness_ab.js";
import type { ABOptions, ProviderUsage } from "./harness_ab.js";
import { OPTIMIZATION_TARGETS } from "./optimization_checks.js";
import type { OptimizationTask } from "./optimization_checks.js";
import { ROOT } from "./lib.js";

type Case = { id: OptimizationTask; prompt: string };
export type OptimizationOptions = ABOptions & { cases: string; embeddingCache?: string };
const ARMS = ["none", "unit", "window", "ast"] as const;
const MEASURED_FILES = ["src/code-memory/indexer.ts", "src/code-memory/source.ts", "src/code-memory/store.ts", "src/code-memory/query.ts", "src/code-memory/chunks.ts", "src/code-memory/vector.ts", "src/code-memory/retrieve.ts", "src/harness/plugin.ts", "scripts/harness_ab.ts", "scripts/harness_meter.ts", "scripts/project_checks_plugin.ts", "scripts/optimization_ab.ts", "scripts/optimization_checks.ts"];
export const optimizationImplementation = () => MEASURED_FILES.flatMap(path => [path, "dist/" + path.replace(/\.ts$/, ".js")]).map(path => ({ path, sha256: hash(readFileSync(join(ROOT, path))) }));
function evaluate(node: string, workspace: string, corpus: string, task: OptimizationTask) {
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  try { return JSON.parse(execFileSync(node, [join(ROOT, "dist/scripts/optimization_checks.js"), workspace, corpus, task], { cwd: workspace, encoding: "utf8", env, timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })) as Record<string, any>; }
  catch (error) {
    const data = error as { stdout?: string; message?: string };
    if (data.stdout) { try { return JSON.parse(data.stdout) as Record<string, any>; } catch { /* Preserve failure. */ } }
    return { pass: false, behavior: { pass: false }, optimization_pass: false, error: data.message?.slice(0, 1000) ?? "Independent evaluator failed" };
  }
}

export async function prepareOptimization(options: Omit<OptimizationOptions, "apiKey">) {
  const cases = JSON.parse(readFileSync(options.cases, "utf8")) as Case[];
  if (!cases.length || cases.some(task => !OPTIMIZATION_TARGETS[task.id] || !task.prompt) || new Set(cases.map(task => task.id)).size !== cases.length) throw new Error("Invalid optimization cases");
  const manifest = createCorpus(options);
  const index = JSON.parse(readFileSync(join(manifest.corpus, ".code-memory/index.json"), "utf8")) as CMIndex;
  const checks = cases.map(task => ({ task: task.id, result: evaluate(options.node, manifest.corpus, manifest.corpus, task.id) }));
  if (checks.some(check => !check.result.behavior?.pass)) throw new Error("Original behavior must pass before candidate runs");
  writeFileSync(join(options.output, "preparation-checks.json"), JSON.stringify(checks, null, 2));
  const indexing: object[] = [];
  for (const chunking of ARMS.slice(1) as ChunkingStrategy[]) {
    const config = { directory: join(options.output, "projections", chunking), modelCache: options.modelCache!, chunking,
      ...(options.embeddingCache ? { embeddingCache: options.embeddingCache } : {}) };
    const result = await buildVectors(index, config);
    indexing.push({ strategy: chunking, ...result });
    writeFileSync(join(options.output, "indexing.json"), JSON.stringify(indexing, null, 2));
  }
  const protocol = { format: "cm-optimization-ab-1", source_project: manifest.project, source_revision: manifest.revision,
    corpus_hash: manifest.manifest_hash, cases_hash: hash(JSON.stringify(cases)), implementations: optimizationImplementation(), arms: ARMS,
    repetitions: options.repetitions ?? 3, model: options.model, reasoning_effort: "low", context_bytes: 6000,
    max_model_calls: options.maxCalls ?? 20, max_run_seconds: options.maxSeconds ?? 300,
    order: "Rotated arm order by task/repetition; reversed alternating rows", seed_regressions: false,
    quality: "All independent behavior and protected-source checks; real CPU elapsed time <=85% baseline with >=7/9 paired wins, stress speedup >=0.9; horizontal construction slowdown <=4; actual changed source required",
    measurements: "9 serial four-pass ABBA/BAAB timing blocks on unchanged actual geometry, paired means; stress separate; no whole-game FPS claim",
    public_checks: "Fixed project_checks tool identical in every arm; three-city short smoke, different fuzz seed from final",
    chunking: "Unit; overlapping UTF-8 windows 768/128 bytes; AST groups bounded to 768 plus compiler-bound dependencies and scope signatures",
    artifact_isolation: "No .code-memory files in agent workspaces; B plugin reads its frozen projection externally and observes exact source through the workspace filesystem",
    limitation: "Two related optimization types in one project, three stochastic repeats; AST scope enrichment changes with granularity" };
  writeFileSync(join(options.output, "frozen-protocol.json"), JSON.stringify(protocol, null, 2));
  return { prepared: true, cases: cases.length, arms: ARMS.length, planned: cases.length * protocol.repetitions * ARMS.length, indexing };
}

export async function runOptimization(options: OptimizationOptions) {
  const cases = JSON.parse(readFileSync(options.cases, "utf8")) as Case[];
  const manifest = JSON.parse(readFileSync(join(options.output, "corpus-manifest.json"), "utf8")) as ReturnType<typeof createCorpus>;
  const protocol = JSON.parse(readFileSync(join(options.output, "frozen-protocol.json"), "utf8"));
  if (protocol.cases_hash !== hash(JSON.stringify(cases)) || protocol.model !== options.model || protocol.repetitions !== (options.repetitions ?? 3) ||
      protocol.max_model_calls !== (options.maxCalls ?? 20) || protocol.max_run_seconds !== (options.maxSeconds ?? 300) || JSON.stringify(protocol.implementations) !== JSON.stringify(optimizationImplementation())) throw new Error("Frozen optimization inputs changed");
  const results: Record<string, any>[] = []; let cost = 0;
  for (let repetition = 1; repetition <= protocol.repetitions; repetition++) for (const [taskIndex, task] of cases.entries()) {
    const offset = (repetition + taskIndex) % ARMS.length;
    const arms = [...ARMS.slice(offset), ...ARMS.slice(0, offset)]; if ((repetition + taskIndex) % 2) arms.reverse();
    for (const arm of arms) {
      if (cost >= 5) throw new Error("Optimization pilot reached USD 5 estimate limit");
      const runId = `${task.id}-r${repetition}-${arm}`;
      const workspace = resolve(options.output, "workspaces", runId);
      if (existsSync(workspace)) throw new Error("Optimization run identity already exists");
      cpSync(manifest.corpus, workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
      writeFileSync(join(options.output, "progress.json"), JSON.stringify({ state: "running", current: runId, completed: results.length, planned: cases.length * protocol.repetitions * ARMS.length }));
      const response = await bootProfile({ ...options, cmMode: "compact", ...(arm !== "none" ? { chunking: arm, cmIndexPath: join(manifest.corpus, ".code-memory/index.json"), cmVectorsPath: join(options.output, "projections", arm) } : {}),
        projectCheck: { plugin: join(ROOT, "dist/scripts/project_checks_plugin.js"), script: join(ROOT, "dist/scripts/optimization_checks.js"), baseline: manifest.corpus, task: task.id } }, workspace, runId, task.prompt, arm !== "none");
      const meterPath = join(response.directory, "meter.json");
      const meter = existsSync(meterPath) ? JSON.parse(readFileSync(meterPath, "utf8")) as { attempts: number; calls: { call: number; usage: ProviderUsage | null; finish: string | null; cm_tools: string[]; cm_context_present: boolean }[] } : { attempts: 0, calls: [] };
      const usage = sumUsage(meter.calls);
      const target = OPTIMIZATION_TARGETS[task.id].path;
      const protectedFiles = [...manifest.files, ...["package.json", "AGENTS.md"].map(path => ({ path, sha256: hash(readFileSync(join(manifest.corpus, path))) }))];
      const scopeChanges = protectedFiles.filter(file => file.path !== target && (!existsSync(join(workspace, file.path)) || hash(readFileSync(join(workspace, file.path))) !== file.sha256)).map(file => file.path);
      const quality = evaluate(options.node, workspace, manifest.corpus, task.id);
      const events = response.events as { type?: string; tool?: string }[];
      const tools = events.filter(event => event.type === "tool_call").map(event => event.tool ?? "unknown");
      const stderr = readFileSync(join(response.directory, "stderr.txt"), "utf8");
      const accounted = meter.calls.length > 0 && meter.calls.every((call, i) => call.call === i + 1 && call.usage !== null && call.finish !== null) &&
        (meter.attempts === meter.calls.length || stderr.includes("AB model-call limit reached") && meter.attempts === meter.calls.length + 1 && meter.calls.length === protocol.max_model_calls);
      const cmActive = meter.calls[0]?.cm_context_present && meter.calls[0]?.cm_tools.includes("cm_retrieve_context");
      const record = { run_id: runId, task: task.id, repetition, arm, exit_code: response.exit_code, duration_ms: response.duration_ms,
        behavioral_success: quality.behavior?.pass === true && scopeChanges.length === 0,
        optimization_success: quality.optimization_pass === true && scopeChanges.length === 0, quality, scope_changes: scopeChanges,
        model_calls: meter.calls.length, attempts: meter.attempts, usage, accounting_complete: accounted, cm_active: Boolean(cmActive),
        tool_calls: Object.fromEntries([...new Set(tools)].map(tool => [tool, tools.filter(item => item === tool).length])),
        patch_changed: hash(readFileSync(join(workspace, target))) !== manifest.files.find(file => file.path === target)!.sha256 };
      results.push(record); cost += usage.usd_estimate;
      writeFileSync(join(options.output, "results.json"), JSON.stringify({ protocol, estimated_cost_usd: cost, results }, null, 2));
      if (/INVALID_CREDENTIAL|MISSING_CREDENTIAL|insufficient_quota|AUTH:/.test(stderr)) throw new Error("Provider access failed; preserved run and stopped");
      if (!accounted || Boolean(cmActive) !== (arm !== "none") || stderr.includes("entry did not activate")) throw new Error("Metering/activation failed; preserved run and stopped");
      console.log(JSON.stringify({ run_id: runId, behavior: record.behavioral_success, optimization: record.optimization_success, real_speedup: quality.performance?.real?.speedup ?? null, tokens: usage.total_tokens, model_calls: record.model_calls }));
    }
  }
  const changes = manifest.files.filter(file => !existsSync(join(manifest.project, file.path)) || hash(readFileSync(join(manifest.project, file.path))) !== file.sha256).map(file => file.path);
  const stable = JSON.stringify(protocol.implementations) === JSON.stringify(optimizationImplementation());
  writeFileSync(join(options.output, "source-proof.json"), JSON.stringify({ original_files_checked: manifest.files.length, original_source_changes: changes, measured_implementation_unchanged: stable }, null, 2));
  if (changes.length || !stable) throw new Error("Original or measured source changed");
  writeFileSync(join(options.output, "progress.json"), JSON.stringify({ state: "complete", completed: results.length, planned: results.length, estimated_cost_usd: cost }));
  return { completed: results.length, estimated_cost_usd: cost };
}
