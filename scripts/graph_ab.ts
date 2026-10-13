import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { bootProfile, createCorpus, sumUsage } from "./harness_ab.js";
import type { ABOptions, ABCase, ProviderUsage } from "./harness_ab.js";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildVectors, embeddingFingerprints, EMBEDDING } from "../src/code-memory/vector.js";
import { hash } from "../src/code-memory/source.js";
import { ROOT } from "./lib.js";

type Options = ABOptions & { cases: string };
const ARMS = ["none", "hybrid", "graph", "adaptive"] as const;
const sourceFiles = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(directory + "/" + entry.name) : entry.name.endsWith(".ts") ? [directory + "/" + entry.name] : []);
const FILES = [...sourceFiles("src"), "scripts/lib.ts", "scripts/harness_ab.ts", "scripts/harness_meter.ts", "scripts/graph_ab.ts", "scripts/graph_checks.ts", "scripts/run_graph_ab.ts", "scripts/project_checks_plugin.ts"].sort();
const implementation = () => [...FILES.flatMap(path => [{ path, sha256: hash(readFileSync(join(ROOT, path))) }, { path: "dist/" + path.replace(/\.ts$/, ".js"), sha256: hash(readFileSync(join(ROOT, "dist", path.replace(/\.ts$/, ".js")))) }]), { path: "contracts/cm-local.schema.json", sha256: hash(readFileSync(join(ROOT, "contracts/cm-local.schema.json"))) }];
export function sealGraphProtocol(options: Options) {
  const output = resolve(options.output), path = join(output, "frozen-protocol.json");
  if (existsSync(join(output, "results.json")) || existsSync(join(output, "progress.json")) || existsSync(join(output, "pre-seal-protocol.json"))) throw Error("Protocol may only be sealed once before model runs");
  const protocol = JSON.parse(readFileSync(path, "utf8"));
  if (hash(JSON.stringify(JSON.parse(readFileSync(options.cases, "utf8")))) !== protocol.cases_hash) throw Error("Selected cases changed");
  cpSync(path, join(output, "pre-seal-protocol.json"));
  protocol.implementation = implementation();protocol.sealed_at = new Date().toISOString();
  protocol.seal_reason = "Before any paid model runs, freeze all source modules, actual compiled modules, grader, runner and schema after lifecycle checks";
  writeFileSync(path, JSON.stringify(protocol, null, 2));return { sealed: true, files: protocol.implementation.length };
}
function grade(options: Options, workspace: string, task: string) {
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  try { return JSON.parse(execFileSync(options.node, [join(ROOT, "dist/scripts/graph_checks.js"), workspace, workspace, task], { encoding: "utf8", env, timeout: 25000, windowsHide: true })); }
  catch (error) { const failure = error as { stdout?: string };return failure.stdout ? JSON.parse(failure.stdout) : { pass: false, error: "Candidate prevented independent checks" }; }
}
export async function prepareGraphAB(options: Options) {
  const output = resolve(options.output);if (existsSync(join(output, "frozen-protocol.json"))) throw Error("Preserve existing protocol");
  const cases = JSON.parse(readFileSync(options.cases, "utf8")) as ABCase[];
  const manifest = createCorpus(options), paths = manifest.files.map(file => file.path), preparation = [];
  const embeddingCache = join(output, "embedding-cache.json"), prior = JSON.parse(readFileSync(join(ROOT, ".artifacts/optimization-embedding-cache.json"), "utf8"));
  if (JSON.stringify(prior.embedding) !== JSON.stringify(EMBEDDING)) throw Error("Reusable embedding model mismatch");
  const baselineIndex = JSON.parse(readFileSync(join(manifest.corpus, ".code-memory/index.json"), "utf8"));
  const fingerprints = new Set(embeddingFingerprints(baselineIndex));
  writeFileSync(embeddingCache, JSON.stringify({ embedding: EMBEDDING, values: Object.fromEntries(Object.entries(prior.values).filter(([fingerprint]) => fingerprints.has(fingerprint))) }));
  for (const task of cases) {
    const baseline = grade(options, manifest.corpus, task.id);if (!baseline.pass) throw Error("Baseline grader failed: " + task.id + " " + baseline.error);
    const workspace = join(output, "cases", task.id);cpSync(manifest.corpus, workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
    for (const mutation of task.mutations) { const path = join(workspace, mutation.path), source = readFileSync(path, "utf8");if (source.split(mutation.before).length !== 2) throw Error("Seed is not unique");writeFileSync(path, source.replace(mutation.before, mutation.after)); }
    const seeded = grade(options, workspace, task.id);if (seeded.pass) throw Error("Grader accepts seeded regression: " + task.id);
    const started = performance.now(), index = buildIndex(workspace, paths);mkdirSync(join(workspace, ".code-memory"));
    writeFileSync(join(workspace, ".code-memory/index.json"), JSON.stringify(index));
    const vectors = await buildVectors(index, { directory: join(output, "projections", task.id), modelCache: options.modelCache!, embeddingCache });
    preparation.push({ task: task.id, baseline, seeded, snapshot_id: index.snapshot_id, milliseconds: performance.now() - started, vectors });
    writeFileSync(join(output, "preparation.json"), JSON.stringify(preparation, null, 2));
    console.log(JSON.stringify({ phase: "prepared", task: task.id, baseline: baseline.pass, seeded: seeded.pass, rows: vectors.rows, reused: vectors.reused }));
  }
  const protocol = { format: "cm-graph-budget-ab-1", model: options.model, reasoning_effort: "low", repetitions: options.repetitions ?? 2, arms: ARMS,
    cases_hash: hash(JSON.stringify(cases)), corpus_hash: manifest.manifest_hash, source_revision: manifest.revision, implementation: implementation(),
    max_model_calls: options.maxCalls ?? 12, max_run_seconds: options.maxSeconds ?? 240, context_source_bytes: 6000,
    policy: "none has no CM; hybrid is existing 0.5 policy; graph uses fused seeds plus compiler-neighbor reranking/bounded declaration closure; adaptive skips dense for an unambiguous named anchor and exposes focused/expanded detail",
    quality: "Independent final behavior plus protected-source/addition audit; unchanged seeded code fails; full provider usage on all runs",
    order: "Rotate all four arms per case/repetition; reverse alternating rows", seed_regressions: true,
    public_checks: "Same fixed project_checks tool in every arm, distinct public/final fuzz seed", price: { input: .10, cached: .01, cache_write: .125, output: .50, per: 1000000, source: "https://developers.openai.com/api/docs/models/gpt-6-luna" },
    limitations: ["Six new seeded repair types, one Geo Dash repository, two stochastic repeats; not a whole-game optimization benchmark", "Source byte budget/coverage is not a GPT tokenizer count", "Local preprocessing time/cached embedding reuse measured separately; no paid enrichment", "Adaptive exact route is allowed without a dense query; vectors/search mode exact otherwise held fixed"] };
  writeFileSync(join(output, "frozen-protocol.json"), JSON.stringify(protocol, null, 2));return { planned: cases.length * ARMS.length * protocol.repetitions, cases: cases.length };
}
export async function runGraphAB(options: Options) {
  const output = resolve(options.output), protocol = JSON.parse(readFileSync(join(output, "frozen-protocol.json"), "utf8"));
  const cases = JSON.parse(readFileSync(options.cases, "utf8")) as ABCase[], manifest = JSON.parse(readFileSync(join(output, "corpus-manifest.json"), "utf8"));
  if (hash(JSON.stringify(cases)) !== protocol.cases_hash || JSON.stringify(implementation()) !== JSON.stringify(protocol.implementation) || options.model !== protocol.model || (options.repetitions ?? 2) !== protocol.repetitions) throw Error("Frozen inputs changed");
  const results: Record<string, any>[] = [];let cost = 0;
  for (let repetition = 1; repetition <= protocol.repetitions; repetition++) for (const [caseIndex, task] of cases.entries()) {
    const offset = (caseIndex + repetition) % ARMS.length, order = [...ARMS.slice(offset), ...ARMS.slice(0, offset)];if ((caseIndex + repetition) % 2) order.reverse();
    for (const arm of order) {
      if (cost >= 5) throw Error("Pilot USD5 estimate budget reached");
      const runId = `${task.id}-r${repetition}-${arm}`, source = join(output, "cases", task.id), workspace = join(output, "workspaces", runId);
      if (existsSync(workspace)) throw Error("Preserve run identity");cpSync(source, workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
      writeFileSync(join(output, "progress.json"), JSON.stringify({ state: "running", current: runId, completed: results.length, planned: cases.length * 4 * protocol.repetitions }));
      const response = await bootProfile({ ...options, cmMode: "compact", contextBytes: 6000, ...(arm !== "none" ? { retrievalPolicy: arm, autoUpdate: true, embeddingCache: join(output, "embedding-cache.json"), cmIndexPath: join(source, ".code-memory/index.json"), cmVectorsPath: join(output, "projections", task.id), chunking: "unit" } : {}),
        projectCheck: { plugin: join(ROOT, "dist/scripts/project_checks_plugin.js"), script: join(ROOT, "dist/scripts/graph_checks.js"), baseline: manifest.corpus, task: task.id } }, workspace, runId, task.prompt, arm !== "none");
      const meterPath = join(response.directory, "meter.json"), meter = existsSync(meterPath) ? JSON.parse(readFileSync(meterPath, "utf8")) : { attempts: 0, calls: [] };
      const usage = sumUsage(meter.calls as { usage: ProviderUsage | null }[]), quality = grade(options, workspace, task.id);
      const allowed = new Set(task.mutations.map(mutation => mutation.path)), originalPaths = [...manifest.files.map((file: any) => file.path), "package.json", "AGENTS.md"];
      const scopeChanges = originalPaths.filter((path: string) => !allowed.has(path) && (!existsSync(join(workspace, path)) || hash(readFileSync(join(source, path))) !== hash(readFileSync(join(workspace, path)))));
      const added = execFileSync(options.node, ["--input-type=module", "-e", "import{readdirSync}from'node:fs';import{join}from'node:path';const walk=(dir,p='')=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name),p+e.name+'/'):[p+e.name]);console.log(JSON.stringify(walk(process.argv[1])));", workspace], { encoding: "utf8" });
      const addedFiles = (JSON.parse(added) as string[]).filter(path => !originalPaths.includes(path));
      const calls = meter.calls as any[], stderr = readFileSync(join(response.directory, "stderr.txt"), "utf8");
      const accounted = calls.length > 0 && calls.every((call, i) => call.call === i + 1 && call.usage && call.finish) && (meter.attempts === calls.length || stderr.includes("AB model-call limit reached") && meter.attempts === calls.length + 1 && calls.length === protocol.max_model_calls);
      const active = Boolean(calls[0]?.cm_context_present && calls[0]?.cm_tools.includes("cm_retrieve_context"));
      const events = response.events as { type?: string; tool?: string }[], tools = events.filter(event => event.type === "tool_call").map(event => event.tool ?? "unknown");
      const retrievalPath = join(response.directory, "retrieval.json"), retrieval = existsSync(retrievalPath) ? JSON.parse(readFileSync(retrievalPath, "utf8")) : [];
      const record = { run_id: runId, task: task.id, repetition, arm, duration_ms: response.duration_ms, exit_code: response.exit_code,
        task_success: quality.pass === true && !scopeChanges.length && !addedFiles.length, quality, scope_changes: scopeChanges, added_files: addedFiles,
        model_calls: calls.length, attempts: meter.attempts, usage, accounting_complete: Boolean(accounted), cm_active: active,
        tool_calls: Object.fromEntries([...new Set(tools)].map(tool => [tool, tools.filter(name => name === tool).length])),
        request_bytes_total: calls.reduce((sum, call) => sum + (call.request_bytes ?? 0), 0), schema_bytes_total: calls.reduce((sum, call) => sum + (call.schema_bytes ?? 0), 0),
        context_occurrences_total: calls.reduce((sum, call) => sum + (call.cm_context_occurrences ?? 0), 0), initial_retrieval: retrieval.find((event: any) => event.event === "retrieved") ?? null };
      results.push(record);cost += usage.usd_estimate;writeFileSync(join(output, "results.json"), JSON.stringify({ protocol, estimated_cost_usd: cost, results }, null, 2));
      console.log(JSON.stringify({ run_id: runId, quality: record.task_success, calls: record.model_calls, tokens: usage.total_tokens, usd: usage.usd_estimate }));
      if (/INVALID_CREDENTIAL|MISSING_CREDENTIAL|insufficient_quota|AUTH:/.test(stderr) || !accounted || active !== (arm !== "none")) throw Error("Provider/accounting/activation failure; run retained");
    }
  }
  const changes = manifest.files.filter((file: any) => !existsSync(join(manifest.project, file.path)) || hash(readFileSync(join(manifest.project, file.path))) !== file.sha256).map((file: any) => file.path);
  writeFileSync(join(output, "source-proof.json"), JSON.stringify({ original_files_checked: manifest.files.length, original_source_changes: changes, measured_implementation_unchanged: JSON.stringify(implementation()) === JSON.stringify(protocol.implementation) }, null, 2));
  if (changes.length) throw Error("Original source changed");writeFileSync(join(output, "progress.json"), JSON.stringify({ state: "complete", completed: results.length, planned: results.length, cost }));
  return { completed: results.length, estimated_cost_usd: cost };
}
