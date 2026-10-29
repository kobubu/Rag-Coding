import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { bootProfile, createCorpus, sumUsage } from "./harness_ab.js";
import type { ABOptions, ABCase, ProviderUsage } from "./harness_ab.js";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildVectors, EMBEDDING } from "../src/code-memory/vector.js";
import { hash, inside } from "../src/code-memory/source.js";
import { ROOT } from "./lib.js";

// Three-arm agentic efficiency A/B: no CM, a frozen CM build (baseline) and the current CM build (candidate).
// Same tasks, model, tools, limits and independent grader as the 0.7.0 speed study; arms are selected per run.
type Task = ABCase & { category: string; changed_paths?: string[] };
export const ARMS = ["none", "cm_base", "cm_next"] as const;
export type Arm = typeof ARMS[number];
type Options = ABOptions & { cases: string; reuseCache: string; basePlugin: string; arms: Arm[]; budgetUsd?: number };
const PROMPT_SUFFIX = " Apply the change only in this isolated workspace. Preserve unrelated behavior and interfaces. Use supplied source when sufficient; otherwise inspect code. The same project_checks smoke is available to all variants; separate independent final checks evaluate your patch. Finish with a brief summary.";
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
const sources = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(directory + "/" + entry.name) : entry.name.endsWith(".ts") ? [directory + "/" + entry.name] : []);
const implementation = () => [...sources("src"), "scripts/harness_ab.ts", "scripts/harness_meter.ts", "scripts/efficiency_ab.ts", "scripts/speed_checks.ts", "scripts/holdout_checks.ts", "scripts/semver_checks.ts", "scripts/superstruct_checks.ts", "scripts/project_checks_plugin.ts", "scripts/lib.ts"].sort()
  .flatMap(path => [path, "dist/" + path.replace(/\.ts$/, ".js")]).map(path => ({ path, sha256: hash(readFileSync(join(ROOT, path))) }));
const pluginDigest = (plugin: string) => hash(readdirSync(resolve(plugin, ".."), { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name + ":" + hash(readFileSync(resolve(plugin, "..", e.name)))).sort().join("\n"));

function grade(options: Options, workspace: string, baseline: string, task: string) {
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  try { return JSON.parse(execFileSync(options.node, [join(ROOT, "dist/scripts/speed_checks.js"), workspace, baseline, task], { env, encoding: "utf8", timeout: 30000, windowsHide: true })); }
  catch (error) { const failure = error as { stdout?: string }; return failure.stdout ? JSON.parse(failure.stdout) : { pass: false, error: "Independent grader could not run" }; }
}

export async function prepareEfficiencyAB(options: Options) {
  const output = resolve(options.output); if (existsSync(output)) throw Error("Select a fresh experiment directory");
  const tasks = read(options.cases) as Task[];
  if (!tasks.length || tasks.some(t => !/^[a-z0-9-]+$/.test(t.id)) || new Set(tasks.map(t => t.id)).size !== tasks.length) throw Error("Invalid tasks");
  const manifest = createCorpus(options), cache = read(options.reuseCache), embeddingCache = join(output, "embedding-cache.json");
  if (JSON.stringify(cache.embedding) !== JSON.stringify(EMBEDDING)) throw Error("Wrong embedding cache"); write(embeddingCache, cache);
  const prepared = [];
  for (const task of tasks) {
    const baseline = grade(options, manifest.corpus, manifest.corpus, task.id); if (!baseline.behavior_pass) throw Error("Original behavior fails: " + task.id + JSON.stringify(baseline));
    const workspace = join(output, "cases", task.id); cpSync(manifest.corpus, workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
    for (const mutation of task.mutations) {
      const path = resolve(workspace, mutation.path); if (!inside(workspace, path)) throw Error("Unsafe mutation");
      const source = readFileSync(path, "utf8"); if (source.split(mutation.before).length !== 2) throw Error("Mutation must match once");
      writeFileSync(path, source.replace(mutation.before, mutation.after));
    }
    const seeded = grade(options, workspace, manifest.corpus, task.id); if (seeded.pass) throw Error("Unchanged task unexpectedly passes: " + task.id);
    const started = performance.now(), index = buildIndex(workspace, manifest.files.map(f => f.path));
    mkdirSync(join(workspace, ".code-memory")); write(join(workspace, ".code-memory/index.json"), index);
    const vectors = await buildVectors(index, { directory: join(output, "projections", task.id), modelCache: options.modelCache!, embeddingCache, chunking: "unit" });
    prepared.push({ task: task.id, category: task.category, baseline, seeded, preparation_ms: performance.now() - started, vectors });
    write(join(output, "preparation.json"), prepared);
    console.log(JSON.stringify({ phase: "prepared", task: task.id, rows: vectors.rows }));
  }
  return { tasks: tasks.length, corpus_files: manifest.files.length };
}

export function freezeProtocol(options: Options) {
  const output = resolve(options.output), tasks = read(options.cases) as Task[], manifest = read(join(output, "corpus-manifest.json"));
  const protocolPath = join(output, "frozen-protocol-" + options.arms.join("+") + ".json"); if (existsSync(protocolPath)) throw Error("Protocol already frozen");
  const protocol = { format: "cm-efficiency-1", created_at: new Date().toISOString(), model: options.model, reasoning_effort: "low", arms: options.arms, repetitions: options.repetitions ?? 2,
    cases_hash: hash(JSON.stringify(tasks)), corpus_hash: manifest.manifest_hash, source_revision: manifest.revision, implementation: implementation(), base_plugin_sha256: pluginDigest(options.basePlugin),
    runtime: { node: process.version, harness_entry_sha256: hash(readFileSync(options.harness)) }, preparation_sha256: hash(readFileSync(join(output, "preparation.json"))),
    max_model_calls: options.maxCalls ?? 12, max_run_seconds: options.maxSeconds ?? 240, max_estimated_usd: options.budgetUsd ?? 2, context_source_bytes: 6000, prompt_suffix: PROMPT_SUFFIX,
    arms_config: { none: "No CM", cm_base: "Frozen CM 0.8.1 build, adaptive/exact, autoUpdate on demand", cm_next: "Current CM build, same configuration" },
    price: { input: .10, cache_read: .01, cache_write: .125, output: .50, per: 1000000, source: "https://developers.openai.com/api/docs/models/gpt-6-luna" } };
  write(protocolPath, protocol); return protocolPath;
}

export async function runEfficiencyAB(options: Options, protocolPath: string) {
  const output = resolve(options.output), protocol = read(protocolPath), manifest = read(join(output, "corpus-manifest.json")), tasks = read(options.cases) as Task[];
  const arms = protocol.arms as Arm[], label = arms.join("+"), resultsPath = join(output, "results-" + label + ".json");
  if (existsSync(resultsPath)) throw Error("Preserve experiment identities");
  if (hash(JSON.stringify(tasks)) !== protocol.cases_hash || JSON.stringify(implementation()) !== JSON.stringify(protocol.implementation) || pluginDigest(options.basePlugin) !== protocol.base_plugin_sha256
    || hash(readFileSync(join(output, "preparation.json"))) !== protocol.preparation_sha256 || hash(readFileSync(options.harness)) !== protocol.runtime.harness_entry_sha256) throw Error("Frozen inputs changed");
  const results: Record<string, any>[] = []; let cost = 0;
  for (let rep = 1; rep <= protocol.repetitions; rep++) for (const [position, task] of tasks.entries()) {
    const offset = (position + rep) % arms.length, order = [...arms.slice(offset), ...arms.slice(0, offset)]; if ((position + rep) % 2) order.reverse();
    for (const arm of order) {
      if (cost >= protocol.max_estimated_usd) throw Error("Experiment cost budget reached");
      const runId = "run-" + hash(`${output}:${label}:${task.id}:${rep}:${arm}`).slice(0, 16), source = join(output, "cases", task.id), workspace = join(output, "workspaces", runId), allStarted = performance.now();
      if (existsSync(workspace)) throw Error("Workspace exists"); cpSync(source, workspace, { recursive: true, filter: path => !path.includes(".code-memory") }); const copyMs = performance.now() - allStarted;
      const cm = arm !== "none";
      const response = await bootProfile({ ...options, cmMode: "compact", contextBytes: 6000, ...(cm ? { autoUpdate: true, searchMode: "exact" as const, backgroundUpdate: false,
        ...(arm === "cm_base" ? { cmPluginPath: options.basePlugin } : {}), embeddingCache: join(output, "embedding-cache.json"), cmIndexPath: join(source, ".code-memory/index.json"), cmVectorsPath: join(output, "projections", task.id) } : {}),
        projectCheck: { plugin: join(ROOT, "dist/scripts/project_checks_plugin.js"), script: join(ROOT, "dist/scripts/speed_checks.js"), task: task.id, baseline: manifest.corpus } }, workspace, runId, task.prompt + protocol.prompt_suffix, cm);
      const meterPath = join(response.directory, "meter.json"), meter = existsSync(meterPath) ? read(meterPath) : { attempts: 0, calls: [] }, calls = meter.calls as any[];
      const usage = sumUsage(calls as { usage: ProviderUsage | null }[]), gradeStarted = performance.now(), quality = grade(options, workspace, manifest.corpus, task.id), gradeMs = performance.now() - gradeStarted;
      const allowed = new Set(task.changed_paths ?? task.mutations.map(m => m.path)), originalPaths = [...manifest.files.map((f: any) => f.path), "package.json", "AGENTS.md"];
      const scopeChanges = originalPaths.filter((path: string) => !allowed.has(path) && (!existsSync(join(workspace, path)) || hash(readFileSync(join(source, path))) !== hash(readFileSync(join(workspace, path)))));
      const walk = (directory: string, prefix = ""): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(directory, e.name), prefix + e.name + "/") : [prefix + e.name]);
      const addedFiles = walk(workspace).filter(path => !originalPaths.includes(path)), stderr = readFileSync(join(response.directory, "stderr.txt"), "utf8");
      const accounted = calls.length > 0 && calls.every((c, i) => c.call === i + 1 && c.usage && c.finish) && (meter.attempts === calls.length || stderr.includes("AB model-call limit reached") && meter.attempts === calls.length + 1 && calls.length === protocol.max_model_calls);
      const active = Boolean(calls[0]?.cm_context_present && calls[0]?.cm_tools.includes("cm_retrieve_context")), retrievalPath = join(response.directory, "retrieval.json");
      const retrieval = existsSync(retrievalPath) ? read(retrievalPath) : [], initial = retrieval.find((e: any) => e.event === "retrieved") ?? null;
      const mode = cm ? active && initial?.retrieval?.policy === "adaptive" : !active && !retrieval.length;
      const tools = (response.events as { type?: string; tool?: string }[]).filter(e => e.type === "tool_call").map(e => e.tool ?? "unknown");
      const record = { run_id: runId, task: task.id, category: task.category, repetition: rep, arm, duration_ms: response.duration_ms, copy_ms: copyMs, independent_check_ms: gradeMs, end_to_end_ms: performance.now() - allStarted, exit_code: response.exit_code,
        task_success: Boolean(quality.pass && !scopeChanges.length && !addedFiles.length), quality, scope_changes: scopeChanges, added_files: addedFiles, model_calls: calls.length, attempts: meter.attempts, usage, accounting_complete: Boolean(accounted), mode_verified: Boolean(mode), cm_active: active,
        provider_ms: calls.reduce((s, c) => s + c.duration_ms, 0), request_bytes: calls.map(c => c.request_bytes), tool_calls: Object.fromEntries([...new Set(tools)].map(t => [t, tools.filter(v => v === t).length])), initial_retrieval: initial };
      results.push(record); cost += usage.usd_estimate; write(resultsPath, { protocol, estimated_cost_usd: cost, results });
      console.log(JSON.stringify({ completed: results.length, task: task.id, rep, arm, success: record.task_success, calls: record.model_calls, tokens: usage.total_tokens, seconds: Math.round(response.duration_ms) / 1000, mode }));
      if (/INVALID_CREDENTIAL|MISSING_CREDENTIAL|insufficient_quota|AUTH:/.test(stderr) || !accounted || !mode) throw Error("Provider/accounting/activation failure; retained " + runId);
    }
  }
  if (JSON.stringify(implementation()) !== JSON.stringify(protocol.implementation)) throw Error("Measured code changed during trial");
  return { completed: results.length, cost, results: resultsPath };
}
