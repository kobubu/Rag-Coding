import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { buildIndex } from "../src/code-memory/indexer.js";
import { hash, inside } from "../src/code-memory/source.js";
import { validateIndex } from "../src/code-memory/store.js";
import { ROOT } from "./lib.js";
import type { ChunkingStrategy } from "../src/code-memory/chunks.js";
import type { RetrievalPolicy } from "../src/code-memory/graph_retrieve.js";

export type ABOptions = { project: string; output: string; node: string; harness: string; apiKey: string; model: string; environment?: Record<string, string>; cmMode?: "legacy" | "compact"; retrievalPolicy?: RetrievalPolicy; searchMode?: "exact" | "ann"; contextBytes?: number; autoUpdate?: boolean; backgroundUpdate?: boolean; cmPluginPath?: string; embeddingCache?: string; modelCache?: string; repetitions?: number; chunking?: ChunkingStrategy; maxCalls?: number; maxSeconds?: number; cmIndexPath?: string; cmVectorsPath?: string; projectCheck?: { plugin: string; script: string; task: string; baseline: string } };
export type ABCase = { id: string; prompt: string; mutations: { path: string; before: string; after: string }[] };

export type ProviderUsage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; totalTokens?: number };

export function sumUsage(calls: { usage: ProviderUsage | null }[]) {
  const totals = { uncached_input: 0, cache_read: 0, cache_write: 0, output: 0, total_input: 0, total_tokens: 0, missing_usage: 0 };
  for (const call of calls) {
    if (call.usage === null) { totals.missing_usage++; continue; }
    const usage = call.usage;
    const values = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Invalid provider token counters");
    const input = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    const total = input + usage.outputTokens;
    if (usage.totalTokens !== undefined && usage.totalTokens !== total) throw new Error("Provider token counters do not reconcile");
    totals.uncached_input += usage.inputTokens;
    totals.cache_read += usage.cacheReadTokens ?? 0;
    totals.cache_write += usage.cacheWriteTokens ?? 0;
    totals.output += usage.outputTokens;
    totals.total_input += input;
    totals.total_tokens += total;
  }
  return { ...totals, usd_estimate: (totals.uncached_input * 0.10 + totals.cache_read * 0.01 + totals.cache_write * 0.125 + totals.output * 0.50) / 1e6 };
}

export function createCorpus(options: Omit<ABOptions, "apiKey" | "model">) {
  const project = resolve(options.project);
  const output = resolve(options.output);
  if (existsSync(join(output, "corpus-manifest.json"))) throw new Error("Use a new experiment output directory");
  const corpus = join(output, "corpus");
  mkdirSync(corpus, { recursive: true });
  const revision = execFileSync("git", ["-C", project, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync("git", ["-C", project, "status", "--porcelain"], { encoding: "utf8" });
  const paths = execFileSync("git", ["-C", project, "ls-files", "-z", "game/**/*.js"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const files = paths.map((path) => {
    const target = resolve(corpus, path);
    if (!inside(corpus, target)) throw new Error("Unsafe manifest path");
    const bytes = readFileSync(join(project, path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    return { path, sha256: hash(bytes), bytes: bytes.length };
  });
  copyFileSync(join(project, "package.json"), join(corpus, "package.json"));
  const instructions = readFileSync(join(project, "AGENTS.md"), "utf8") + "\n\n# Isolated benchmark workspace\nWork only inside this workspace. Do not publish, commit, deploy, or access other projects. Apply the requested code fix; an external evaluator checks the result.\n";
  writeFileSync(join(corpus, "AGENTS.md"), instructions);
  const indexStart = performance.now();
  const index = validateIndex(buildIndex(corpus, paths));
  mkdirSync(join(corpus, ".code-memory"), { recursive: true });
  const serialized = JSON.stringify(index);
  writeFileSync(join(corpus, ".code-memory/index.json"), serialized);
  const manifest = { project, revision, original_status: status, corpus, files, manifest_hash: hash(JSON.stringify(files)),
    source_bytes: files.reduce((total, file) => total + file.bytes, 0), derived_bytes: Buffer.byteLength(serialized),
    index_ms: performance.now() - indexStart, snapshot_id: index.snapshot_id, units: index.units.length,
    symbols: index.symbols.length, relations: index.relations.length, diagnostics: index.diagnostics.length };
  writeFileSync(join(output, "corpus-manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function bootProfile(options: ABOptions, workspace: string, runId: string, prompt: string, cm: boolean) {
  const directory = resolve(options.output, "runs", runId);
  if (existsSync(directory)) throw new Error("Run identity already exists");
  mkdirSync(directory, { recursive: true });
  const profile = "ab";
  const home = join(directory, "harness-home");
  const meter = join(directory, "meter.json");
  const patch = join(directory, "profile.patch.yml");
  const disabled = ["session-title-llm", "tool-bash", "tool-pwsh", "tool-jobs", "tool-web", "tool-goal", "tool-workflow", "tool-subagent", "tool-subagent-fork", "tool-subagent-control", "tool-subagent-list-agents", "tool-ralph"];
  const entries: object[] = disabled.map((id) => ({ id, disabled: true }));
  entries.push({ id: "llm-pi-ai", config: { providers: { "ab-openai": { apiKeyEnv: "CM_AB_API_KEY", api: "openai-responses",
    baseURL: "https://api.openai.com/v1", timeoutMs: 90000, retryPolicy: { mode: "normal", maxRetries: 0 },
    models: [{ id: options.model, name: options.model, contextWindow: 1050000, maxTokens: 8192, input: ["text"], reasoningEfforts: { low: "low" } }] } } } });
  entries.push({ id: "agent-default-model", config: { provider: "ab-openai", model: options.model, reasoningEffort: "low" } });
  entries.push({ id: "approval", config: { policy: "never" } });
  entries.push({ id: "permission", config: { presets: { "workspace-write": { sandbox: "workspace-write", approval: "never" } }, defaultPreset: "workspace-write" } });
  const inserted: { id: string; name: string; config: Record<string, unknown> }[] = [{ id: "ab-meter", name: pathToFileURL(join(ROOT, "dist/scripts/harness_meter.js")).href,
    config: { output: meter, model: options.model, maxCalls: options.maxCalls ?? 12, requireCMContext: cm && options.cmMode === "compact" } }];
  if (options.projectCheck) inserted.push({ id: "project-checks", name: pathToFileURL(resolve(options.projectCheck.plugin)).href,
    config: { node: options.node, script: options.projectCheck.script, task: options.projectCheck.task, baseline: options.projectCheck.baseline, workspace } });
  if (cm) inserted.push({ id: "code-memory", name: pathToFileURL(resolve(options.cmPluginPath ?? join(ROOT, "dist/src/harness/plugin.js"))).href,
    config: { projectRoot: workspace, mode: options.cmMode ?? "legacy", ...(options.cmMode === "compact" ? { autoContext: true,
      modelCache: options.modelCache, chunking: options.chunking ?? "unit", ...(options.backgroundUpdate !== undefined ? { backgroundUpdate: options.backgroundUpdate } : {}), ...(options.searchMode ? { searchMode: options.searchMode } : {}), ...(options.retrievalPolicy ? { retrievalPolicy: options.retrievalPolicy } : {}), ...(options.autoUpdate ? { autoUpdate: true, memoryDirectory: join(ROOT, ".artifacts/cm-live-runs", hash(options.output + runId).slice(0, 16)), ...(options.embeddingCache ? { embeddingCache: options.embeddingCache } : {}) } : {}), ...(options.cmIndexPath ? { indexPath: options.cmIndexPath } : {}), ...(options.cmVectorsPath ? { vectorsPath: options.cmVectorsPath } : {}), maxContextBytes: options.contextBytes ?? 6000, diagnosticsPath: join(directory, "retrieval.json") } : {}) } });
  entries.push({ insert: inserted });
  writeFileSync(patch, JSON.stringify(entries));
  const args = [options.harness, "--profile", profile, "--from-default-profile", "headless", "--patch", patch, "--json"];
  const env = { ...(options.environment ?? globalThis.process?.env ?? {}), DSH_HOME: home, CM_AB_API_KEY: options.apiKey, DSH_PERMISSION_MODE: "workspace-write", CM_PROJECT_ROOT: workspace };
  const started = performance.now();
  return await new Promise<{ run_id: string; exit_code: number | null; duration_ms: number; directory: string; events: unknown[] }>((complete, fail) => {
    const child = spawn(options.node, args, { cwd: workspace, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), (options.maxSeconds ?? 180) * 1000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); fail(error); });
    child.on("close", (exit) => {
      clearTimeout(timer);
      const redact = (text: string) => text.replaceAll(options.apiKey, "[redacted]");
      writeFileSync(join(directory, "stdout.jsonl"), redact(stdout));
      writeFileSync(join(directory, "stderr.txt"), redact(stderr));
      const events = redact(stdout).split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => { try { return JSON.parse(line) as unknown; } catch { return null; } }).filter(Boolean);
      const result = { run_id: runId, exit_code: exit, duration_ms: performance.now() - started, directory, events };
      writeFileSync(join(directory, "process-result.json"), JSON.stringify(result, null, 2));
      complete(result);
    });
    child.stdin.end(prompt);
  });
}
