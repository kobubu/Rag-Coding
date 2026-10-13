import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { connect } from "@lancedb/lancedb";
import { bootProfile, createCorpus, sumUsage } from "./harness_ab.js";
import type { ABOptions, ABCase, ProviderUsage } from "./harness_ab.js";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildAnn, buildVectors, EMBEDDING, LocalVectors, localEmbedder } from "../src/code-memory/vector.js";
import { retrieveContext, renderContext } from "../src/code-memory/retrieve.js";
import { hash, inside } from "../src/code-memory/source.js";
import type { CMIndex } from "../src/code-memory/types.js";
import { ROOT } from "./lib.js";

type Options = ABOptions & { cases: string; reuseCache: string };
const ARMS = ["none", "exact", "ann"] as const;
const HOLDOUT = [
  "Stop counting a rewarded advertisement once the daily local allowance has been exhausted",
  "When collecting a coin beside a spring or orb, compare the sorted input outcome contacts",
  "Reuse painted glyph textures while drawing the same label across consecutive frames",
  "Exclude hazards outside the visible horizontal camera interval from collision candidates",
  "Preserve purchased cosmetic skins when upgrading the saved progress data schema",
  "Allow a freely chosen destination city on the planet world map",
  "Which routine adjusts the player's vertical position when landing on a moving platform",
  "Flush native mobile progress persistence after leaving the application",
  "Load a lower resolution image variant for a memory constrained mobile device",
  "Reject a duplicate payment receipt instead of granting the reward a second time",
  "Switch the canvas rendering quality when frame duration remains above the target budget",
  "Keep the first equal length repeated obstacle pattern when computing sequence statistics",
  "Avoid reinitializing the music track while resuming a paused play session",
  "Convert a selected geographic city coordinate into the world map projection",
  "Choose a right to left document direction for an Arabic locale selected by a page query",
  "Free the backing canvas of the oldest unused raster when the local byte budget is exceeded",
] as const;
const sourceFiles = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(directory + "/" + entry.name) : entry.name.endsWith(".ts") ? [directory + "/" + entry.name] : []);
const FILES = [...sourceFiles("src"), "scripts/lib.ts", "scripts/harness_ab.ts", "scripts/harness_meter.ts", "scripts/ann_ab.ts", "scripts/graph_checks.ts", "scripts/run_ann_ab.ts", "scripts/project_checks_plugin.ts"].sort();
const implementation = () => [...FILES.flatMap(path => [{ path, sha256: hash(readFileSync(join(ROOT, path))) }, { path: "dist/" + path.replace(/\.ts$/, ".js"), sha256: hash(readFileSync(join(ROOT, "dist", path.replace(/\.ts$/, ".js")))) }]), { path: "contracts/cm-local.schema.json", sha256: hash(readFileSync(join(ROOT, "contracts/cm-local.schema.json"))) }, { path: "package-lock.json", sha256: hash(readFileSync(join(ROOT, "package-lock.json"))) }];
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

function grade(options: Options, workspace: string, task: string) {
  const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  try { return JSON.parse(execFileSync(options.node, [join(ROOT, "dist/scripts/graph_checks.js"), workspace, workspace, task], { encoding: "utf8", env, timeout: 25000, windowsHide: true })); }
  catch (error) { const failure = error as { stdout?: string };return failure.stdout ? JSON.parse(failure.stdout) : { pass: false, error: "Candidate prevented independent checks" }; }
}

async function compare(options: Options, index: CMIndex, directory: string, queries: { label: string; text: string }[]) {
  const config = { directory, modelCache: options.modelCache!, chunking: "unit" as const };
  const exact = new LocalVectors({ ...config, searchMode: "exact" }), ann = new LocalVectors({ ...config, searchMode: "ann" });
  const manifest = await ann.metadata(index), database = await connect(directory), table = await database.openTable(manifest.table);
  try {
    const indices = await table.listIndices();if (!indices.some(item => item.indexType.toUpperCase().includes("HNSW"))) throw Error("Actual HNSW index required");
    const before = performance.now(), queryVectors = await localEmbedder(config.modelCache)(queries.map(query => query.text)), embeddingMs = performance.now() - before;
    const search = (vector: number[], approximate: boolean) => {
      let request = table.vectorSearch(vector).distanceType("cosine").limit(24);
      request = approximate ? request.nprobes(manifest.ann!.partitions).ef(manifest.ann!.ef_search).refineFactor(manifest.ann!.refine_factor) : request.bypassVectorIndex();
      return request.select(["id", "_distance"]).toArray();
    };
    const measurements = [];
    for (const [position, query] of queries.entries()) {
      const vector = queryVectors[position]!, truth = await search(vector, false), candidate = await search(vector, true), ids = new Set(truth.map(row => row.id));
      const cutoff = Number(truth.at(-1)!._distance), native = [], contexts = [];
      for (let block = 0; block < 5; block++) {
        const samples = [];
        for (const approximate of block % 2 ? [true, false, false, true] : [false, true, true, false]) {
          const start = performance.now();await search(vector, approximate);samples.push({ ann: approximate, milliseconds: performance.now() - start });
        }
        native.push({ exact_ms: samples.filter(row => !row.ann).reduce((sum, row) => sum + row.milliseconds, 0) / 2, ann_ms: samples.filter(row => row.ann).reduce((sum, row) => sum + row.milliseconds, 0) / 2 });
      }
      for (const approximate of position % 2 ? [true, false] : [false, true]) {
        const start = performance.now(), context = await retrieveContext(index, approximate ? ann : exact, query.text, 6000, undefined, { policy: "graph", detail: "focused" });
        contexts.push({ search_mode: approximate ? "ann" : "exact", milliseconds: performance.now() - start, source_bytes: context.bytes_used, sha256: hash(Buffer.from(renderContext(context), "utf8")) });
      }
      measurements.push({ query: query.label, strict_recall_at_24: candidate.filter(row => ids.has(row.id)).length / truth.length,
        tie_aware_recall_at_24: candidate.filter(row => Number(row._distance) <= cutoff + 1e-6).length / truth.length,
        median_exact_ms: median(native.map(row => row.exact_ms)), median_ann_ms: median(native.map(row => row.ann_ms)), native, contexts,
        render_equal: contexts[0]!.sha256 === contexts[1]!.sha256 });
    }
    return { rows: manifest.rows, snapshot_id: index.snapshot_id, records_hash: manifest.records_hash, ann: manifest.ann, indices: indices.map(({ indexType, columns }) => ({ indexType, columns })), embedding_ms: embeddingMs, measurements };
  } finally { exact.close();ann.close();table.close();database.close(); }
}

export async function prepareAnnAB(options: Options) {
  const output = resolve(options.output);if (existsSync(output)) throw Error("Preserve previous experiments; select a new directory");
  const cases = read(options.cases) as ABCase[];
  if (!cases.length || new Set(cases.map(task => task.id)).size !== cases.length || cases.some(task => !/^[a-z0-9-]+$/.test(task.id))) throw Error("Invalid case identities");
  const manifest = createCorpus(options), cache = read(options.reuseCache), embeddingCache = join(output, "embedding-cache.json");
  if (JSON.stringify(cache.embedding) !== JSON.stringify(EMBEDDING)) throw Error("Cached embedding model mismatch");writeFileSync(embeddingCache, JSON.stringify(cache));
  const preparation = [];
  for (const [position, task] of cases.entries()) {
    const baseline = grade(options, manifest.corpus, task.id);if (!baseline.pass) throw Error("Baseline failed: " + task.id);
    const workspace = join(output, "cases", task.id);cpSync(manifest.corpus, workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
    for (const mutation of task.mutations) {
      const path = resolve(workspace, mutation.path);if (!inside(workspace, path)) throw Error("Unsafe mutation path");
      const source = readFileSync(path, "utf8");if (source.split(mutation.before).length !== 2) throw Error("Seed must match exactly once");writeFileSync(path, source.replace(mutation.before, mutation.after));
    }
    const seeded = grade(options, workspace, task.id);if (seeded.pass) throw Error("Seed passes final grader: " + task.id);
    const started = performance.now(), index = buildIndex(workspace, manifest.files.map(file => file.path));mkdirSync(join(workspace, ".code-memory"));writeFileSync(join(workspace, ".code-memory/index.json"), JSON.stringify(index));
    const config = { directory: join(output, "projections", task.id), modelCache: options.modelCache!, embeddingCache, chunking: "unit" as const };
    const vectors = await buildVectors(index, config), built = await buildAnn(index, config);
    const queries = [{ label: task.id, text: task.prompt }, ...(position === 0 ? HOLDOUT.map((text, i) => ({ label: "semantic-holdout-" + i, text })) : [])];
    const comparison = await compare(options, index, config.directory, queries);
    preparation.push({ task: task.id, baseline, seeded, preparation_ms: performance.now() - started, vectors, built, comparison });write(join(output, "preparation.json"), preparation);
    console.log(JSON.stringify({ phase: "prepared", task: task.id, rows: vectors.rows, context_equal: comparison.measurements[0]!.render_equal }));
  }
  const protocol = { format: "cm-hnsw-model-ab-1", created_at: new Date().toISOString(), model: options.model, reasoning_effort: "low", repetitions: options.repetitions ?? 2, arms: ARMS,
    cases_hash: hash(JSON.stringify(cases)), corpus_hash: manifest.manifest_hash, source_revision: manifest.revision, implementation: implementation(),
    preparation_sha256: hash(readFileSync(join(output, "preparation.json"))), runtime: { node_sha256: hash(readFileSync(options.node)), harness_entry_sha256: hash(readFileSync(options.harness)) },
    max_model_calls: options.maxCalls ?? 12, max_run_seconds: options.maxSeconds ?? 240, context_source_bytes: 6000, max_estimated_usd: 1,
    policy: "none has no CM; exact and ann use the same HNSW-bearing physical table, graph policy, unit chunks, embeddings and live refresh; exact explicitly bypasses the vector index",
    quality: "Independent final behavioral checks, protected-source/addition audit, unchanged seeded code must fail; all completed provider usage including failures",
    order: "Rotate three arms across tasks/repetitions and reverse alternating rows", seed_regressions: true,
    semantic_holdout: HOLDOUT, public_checks: "Identical project_checks tool in all three arms; distinct public/final fuzz seed",
    price: { input: .10, cached: .01, cache_write: .125, output: .50, per: 1000000, source: "https://developers.openai.com/api/docs/models/gpt-6-luna" },
    limitations: ["Six previously measured repair tasks reused for a controlled search-mode ablation; not a fresh model holdout", "Sixteen new semantic queries measure exact-neighbor recall, not semantic correctness", "Two stochastic repeats, one repository and device; no whole-game FPS/CPU optimization or statistical noninferiority claim", "Native search speed excludes embeddings/source checks/context assembly; full session timing includes startup and live index rebuilds", "Same rendered context cannot establish a causal ANN token saving from differing model trajectories", "Local cached embeddings and ANN construction are measured separately; model price is an estimate, not invoice"] };
  write(join(output, "frozen-protocol.json"), protocol);return { planned: cases.length * ARMS.length * protocol.repetitions, cases: cases.length, semantic_queries: HOLDOUT.length };
}

export async function runAnnAB(options: Options) {
  const output = resolve(options.output), protocol = read(join(output, "frozen-protocol.json")), manifest = read(join(output, "corpus-manifest.json")), preparation = read(join(output, "preparation.json"));
  const cases = read(options.cases) as ABCase[];
  if (existsSync(join(output, "results.json")) || existsSync(join(output, "progress.json"))) throw Error("Preserve run identities; use a fresh experiment");
  if (hash(JSON.stringify(cases)) !== protocol.cases_hash || JSON.stringify(implementation()) !== JSON.stringify(protocol.implementation) || options.model !== protocol.model || (options.repetitions ?? 2) !== protocol.repetitions || hash(readFileSync(join(output, "preparation.json"))) !== protocol.preparation_sha256 || hash(readFileSync(options.node)) !== protocol.runtime.node_sha256 || hash(readFileSync(options.harness)) !== protocol.runtime.harness_entry_sha256) throw Error("Frozen inputs changed before model runs");
  const results: Record<string, any>[] = [];let cost = 0;
  for (let repetition = 1; repetition <= protocol.repetitions; repetition++) for (const [caseIndex, task] of cases.entries()) {
    const offset = (caseIndex + repetition) % ARMS.length, order = [...ARMS.slice(offset), ...ARMS.slice(0, offset)];if ((caseIndex + repetition) % 2) order.reverse();
    for (const arm of order) {
      if (cost >= protocol.max_estimated_usd) throw Error("Pilot estimated cost budget reached");
      const runId = `${task.id}-r${repetition}-${arm}`, source = join(output, "cases", task.id), workspace = join(output, "workspaces", runId);
      if (existsSync(workspace)) throw Error("Preserve workspace identity");cpSync(source, workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
      write(join(output, "progress.json"), { state: "running", current: runId, completed: results.length, planned: cases.length * ARMS.length * protocol.repetitions });
      const response = await bootProfile({ ...options, cmMode: "compact", contextBytes: 6000, ...(arm !== "none" ? { searchMode: arm, retrievalPolicy: "graph" as const, autoUpdate: true, embeddingCache: join(output, "embedding-cache.json"), cmIndexPath: join(source, ".code-memory/index.json"), cmVectorsPath: join(output, "projections", task.id), chunking: "unit" as const } : {}),
        projectCheck: { plugin: join(ROOT, "dist/scripts/project_checks_plugin.js"), script: join(ROOT, "dist/scripts/graph_checks.js"), baseline: manifest.corpus, task: task.id } }, workspace, runId, task.prompt, arm !== "none");
      const meterPath = join(response.directory, "meter.json"), meter = existsSync(meterPath) ? read(meterPath) : { attempts: 0, calls: [] };
      const calls = meter.calls as any[], usage = sumUsage(calls as { usage: ProviderUsage | null }[]), quality = grade(options, workspace, task.id);
      const allowed = new Set(task.mutations.map(mutation => mutation.path)), originalPaths = [...manifest.files.map((file: any) => file.path), "package.json", "AGENTS.md"];
      const scopeChanges = originalPaths.filter((path: string) => !allowed.has(path) && (!existsSync(join(workspace, path)) || hash(readFileSync(join(source, path))) !== hash(readFileSync(join(workspace, path)))));
      const walk = (directory: string, prefix = ""): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name), prefix + entry.name + "/") : [prefix + entry.name]);
      const addedFiles = walk(workspace).filter(path => !originalPaths.includes(path));
      const stderr = readFileSync(join(response.directory, "stderr.txt"), "utf8");
      const accounted = calls.length > 0 && calls.every((call, i) => call.call === i + 1 && call.usage && call.finish) && (meter.attempts === calls.length || stderr.includes("AB model-call limit reached") && meter.attempts === calls.length + 1 && calls.length === protocol.max_model_calls);
      const active = Boolean(calls[0]?.cm_context_present && calls[0]?.cm_tools.includes("cm_retrieve_context"));
      const events = response.events as { type?: string; tool?: string }[], tools = events.filter(event => event.type === "tool_call").map(event => event.tool ?? "unknown");
      const retrievalPath = join(response.directory, "retrieval.json"), retrieval = existsSync(retrievalPath) ? read(retrievalPath) : [], initial = retrieval.find((event: any) => event.event === "retrieved") ?? null;
      const expected = preparation.find((entry: any) => entry.task === task.id).comparison.measurements[0].contexts.find((entry: any) => entry.search_mode === arm);
      const modeVerified = arm === "none" ? !active && !retrieval.length : active && initial?.search_mode === arm && initial?.context_sha256 === expected?.sha256;
      const record = { run_id: runId, task: task.id, repetition, arm, duration_ms: response.duration_ms, exit_code: response.exit_code,
        task_success: quality.pass === true && !scopeChanges.length && !addedFiles.length, quality, scope_changes: scopeChanges, added_files: addedFiles,
        model_calls: calls.length, attempts: meter.attempts, usage, accounting_complete: Boolean(accounted), cm_active: active, search_mode_verified: Boolean(modeVerified),
        tool_calls: Object.fromEntries([...new Set(tools)].map(tool => [tool, tools.filter(name => name === tool).length])),
        request_bytes_total: calls.reduce((sum, call) => sum + (call.request_bytes ?? 0), 0), schema_bytes_total: calls.reduce((sum, call) => sum + (call.schema_bytes ?? 0), 0),
        context_occurrences_total: calls.reduce((sum, call) => sum + (call.cm_context_occurrences ?? 0), 0), initial_retrieval: initial };
      results.push(record);cost += usage.usd_estimate;write(join(output, "results.json"), { protocol, estimated_cost_usd: cost, results });
      console.log(JSON.stringify({ run_id: runId, quality: record.task_success, calls: record.model_calls, tokens: usage.total_tokens, usd: usage.usd_estimate, search_mode_verified: modeVerified }));
      if (/INVALID_CREDENTIAL|MISSING_CREDENTIAL|insufficient_quota|AUTH:/.test(stderr) || !accounted || !modeVerified) throw Error("Provider/accounting/search-mode failure; run retained");
    }
  }
  const changes = manifest.files.filter((file: any) => !existsSync(join(manifest.project, file.path)) || hash(readFileSync(join(manifest.project, file.path))) !== file.sha256).map((file: any) => file.path);
  const unchanged = JSON.stringify(implementation()) === JSON.stringify(protocol.implementation);
  write(join(output, "source-proof.json"), { original_files_checked: manifest.files.length, original_source_changes: changes, measured_implementation_unchanged: unchanged });
  if (changes.length || !unchanged) throw Error("Source or measured implementation changed during the trial");
  write(join(output, "progress.json"), { state: "complete", completed: results.length, planned: results.length, cost });return { completed: results.length, estimated_cost_usd: cost };
}
