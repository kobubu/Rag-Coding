import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ClientGateway, providerTotals } from "./client_gateway.js";
import { hash } from "../src/code-memory/source.js";
import { CMStore } from "../src/code-memory/store.js";
import { skill } from "../src/setup/config.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LABEL = process.argv[4] ?? "20261015";
if (!/^[a-z0-9-]+$/.test(LABEL)) throw Error("Invalid experiment label");
const PROJECT = "D:/Geo Dash", OUTPUT = resolve(ROOT, ".artifacts/client-ab-" + LABEL), WORK = "D:/CM-AB-" + LABEL, NODE = "D:/CodeMemory/runtime/node-v24.21.0-win-x64/node.exe";
const CODEX = join(ROOT, ".artifacts/native-codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"), CLAUDE = "C:/Users/Igor/.local/bin/claude.exe";
const INSTALLED = JSON.parse(readFileSync("D:/CodeMemory/projects/66e7c932bacb/installation.json", "utf8"));
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")), save = (p: string, value: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value, null, 2)); };
const all = (root: string, prefix = ""): string[] => readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? all(join(root, e.name), prefix + e.name + "/") : [prefix + e.name]);
const baseEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value && !/KEY|TOKEN|SECRET|PASSWORD|AUTH|CODEX|CLAUDE|ANTHROPIC/i.test(name))) as Record<string, string>;
const gatewayFor = (key: string) => new ClientGateway(key, calls => save(join(OUTPUT, "meter-codex.json"), calls));
function stopTree(child: ReturnType<typeof spawn>) {
  if (child.pid && process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill();
}
type Task = { id: string; prompt: string; category: string; allowed: string[] };
const suffix = " Work only inside this isolated Geo Dash checkout. Preserve unrelated behavior, exports and files. You may add focused tests but do not modify existing tests, client configuration or benchmark instructions. Do not access other projects, secrets or the network; do not commit/publish or delegate. Run focused local checks when useful; an independent evaluator checks behavior, scope and CPU where requested. Finish with a brief summary.";

export async function prepareClientAB() {
  if (existsSync(join(OUTPUT, "protocol.json"))) throw Error("Experiment already prepared");
  const started = performance.now(), corpus = join(OUTPUT, "corpus"); mkdirSync(corpus, { recursive: true }); mkdirSync(WORK, { recursive: true });
  const tracked = execFileSync("git", ["-C", PROJECT, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  const selected = tracked.filter(path => /\.(?:[cm]?[jt]sx?|json|css|html|md|yml|yaml)$/.test(path) && (path.startsWith("game/") || path.startsWith("tests/") || path.startsWith("tools/") || ["package.json", "package-lock.json", "tsconfig.json", "jsconfig.json", "AGENTS.md"].includes(path)));
  const files = selected.map(path => { const bytes = readFileSync(join(PROJECT, path)); mkdirSync(dirname(join(corpus, path)), { recursive: true }); writeFileSync(join(corpus, path), bytes); return { path, bytes: bytes.length, sha256: hash(bytes) }; });
  writeFileSync(join(corpus, "AGENTS.md"), readFileSync(join(corpus, "AGENTS.md"), "utf8") + "\n\n# Isolated evaluation\n" + suffix + "\n");
  const frozenFiles = all(corpus).map(path => ({ path, sha256: hash(readFileSync(join(corpus, path))) }));
  const pointer = join(INSTALLED.config.memoryDirectory, "current.json");
  const base = existsSync(pointer) ? join(INSTALLED.config.memoryDirectory, "generations", read(pointer).generation) : dirname(INSTALLED.config.indexPath);
  mkdirSync(join(OUTPUT, "projection"), { recursive: true });
  cpSync(join(base, "index.json"), join(OUTPUT, "projection/index.json")); cpSync(join(base, "vectors"), join(OUTPUT, "projection/vectors"), { recursive: true });
  const index = await new CMStore(corpus, join(OUTPUT, "projection/index.json")).load(AbortSignal.timeout(60000));
  const tasks: Task[] = read(join(ROOT, "evaluation/clients/cases.json"));
  const prep = { files: frozenFiles, original_files: files, source_revision: execFileSync("git", ["-C", PROJECT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), corpus, snapshot_id: index.snapshot_id, source_files: index.files.length, preparation_ms: performance.now() - started };
  save(join(OUTPUT, "preparation.json"), prep);
  const protocol = { format: "cm-native-clients-ab-1", created_at: new Date().toISOString(), task_count: tasks.length, repetitions: 2, arms: ["none", "cm"], clients: ["codex", "claude"], model: { codex: "gpt-6-luna", claude: "pending native CLI account authentication" }, tasks_hash: hash(JSON.stringify(tasks)), grader_hash: hash(readFileSync(join(ROOT, "dist/scripts/client_checks.js"))), source_manifest_hash: hash(JSON.stringify(frozenFiles)), implementation_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(), package_root: INSTALLED.packageRoot, max_seconds: 240, model_call_limit: 16, usd_guard: 2, source_context_budget_bytes: 6000, order: "Counterbalanced AB/BA; opaque equal-length workspaces; each run fresh client process/home and identical saved source; no simultaneous timed sessions", timing: "Client spawn through exit, including MCP startup, actual retrieval and model/tools; copy/setup, index preparation and independent grader measured separately", quality: "Predeclared external behavior/fuzz/export checks, protected-source audit and 1.25x CPU gates for two optimization tasks. No artificial mutations or oracle exposed to agents.", installed_integration: "MCP tool availability plus the installed project skill; no forced tool call or injected answer. Adoption reported, including CM-enabled runs that never call CM.", caveats: ["Single project/device; six tasks with two stochastic repetitions", "Source-and-test snapshot, excludes media and native build dependencies; pure code tasks, no full game FPS claim", "A ready copied projection is used; fresh full indexing cost is separate", "Primary comparisons are within each client; different models across clients are not directly ranked"], prompt_suffix: suffix };
  save(join(OUTPUT, "protocol.json"), protocol); return { status: "prepared", tasks: tasks.length, source_files: index.files.length, copied_files: frozenFiles.length };
}
function mcpArgs(workspace: string, run: string) {
  return [join(INSTALLED.packageRoot, "dist/src/mcp/cli.js"), "--project", workspace, "--index", join(OUTPUT, "projection/index.json"), "--vectors", join(OUTPUT, "projection/vectors"), "--model-cache", INSTALLED.config.modelCache, "--memory-dir", join(OUTPUT, "memory", run), "--retrieval-policy", "adaptive", "--source-scope", "game", "--auto-update", "true", "--background-update", "false"];
}
function codexConfig(workspace: string, gateway: ClientGateway, run: string, cm: boolean, home: string) {
  let config = `model = "gpt-6-luna"\nmodel_provider = "cm_benchmark"\nmodel_reasoning_effort = "low"\nmodel_reasoning_summary = "none"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\nweb_search = "disabled"\n[windows]\nsandbox = "mxc"\n[model_providers.cm_benchmark]\nname = "CM benchmark gateway"\nbase_url = ${JSON.stringify(gateway.url(run))}\nwire_api = "responses"\nenv_key = "CM_LOCAL_PROXY_TOKEN"\nrequires_openai_auth = false\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n`;
  if (cm) {
    const args = mcpArgs(workspace, run);
    config += `[mcp_servers.cm_eval]\ncommand = ${JSON.stringify(NODE)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\n`;
    mkdirSync(join(workspace, ".agents/skills/code-memory"), { recursive: true }); writeFileSync(join(workspace, ".agents/skills/code-memory/SKILL.md"), skill("cm_eval"));
  }
  mkdirSync(home, { recursive: true }); writeFileSync(join(home, "config.toml"), config);
}
async function executeCodex(gateway: ClientGateway, workspace: string, run: string, prompt: string, cm: boolean, seconds: number) {
  const home = join(OUTPUT, "client-homes", run); codexConfig(workspace, gateway, run, cm, home);
  const env = { ...baseEnv(), CODEX_HOME: home, CM_LOCAL_PROXY_TOKEN: gateway.token };
  const started = performance.now(), child = spawn(CODEX, ["--ask-for-approval", "never", "exec", "--sandbox", "workspace-write", "--json", "--ephemeral", "--skip-git-repo-check", "--cd", workspace, "-"], { cwd: workspace, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false; child.stdout.on("data", x => { stdout += x; }); child.stderr.on("data", x => { stderr += x; }); child.stdin.end(prompt);
  const timer = setTimeout(() => { timedOut = true; stopTree(child); }, seconds * 1000);
  const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); }); clearTimeout(timer);
  const elapsed_ms = performance.now() - started, directory = join(OUTPUT, "runs", run); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, "events.jsonl"), stdout); writeFileSync(join(directory, "stderr.txt"), stderr);
  const events = stdout.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  return { code, timed_out: timedOut, elapsed_ms, native_usage: events.filter(e => e.type === "turn.completed").map(e => e.usage), cm_calls: events.filter(e => e.type === "item.completed" && e.item?.type === "mcp_tool_call" && e.item?.tool === "cm_retrieve_context").length, completed: events.some(e => e.type === "turn.completed"), event_types: [...new Set(events.map(e => e.type))] };
}
export async function probeCodex(key: string) {
  const gateway = gatewayFor(key); await gateway.start();
  const run = "calibration-codex", workspace = join(WORK, run); mkdirSync(workspace, { recursive: true }); writeFileSync(join(workspace, "sample.js"), "export const answer = 42;\n");
  try { const result = await executeCodex(gateway, workspace, run, "Read sample.js with a local tool, then report its exported value. Do not modify files or access network/secrets.", false, 90); save(join(OUTPUT, "calibration-codex.json"), { result, calls: gateway.calls, totals: providerTotals(gateway.calls) }); return { ...result, totals: providerTotals(gateway.calls) }; }
  finally { gateway.close(); }
}
export async function probeWrite(key: string) {
  const gateway = gatewayFor(key); await gateway.start(); const workspace = join(WORK, "calibration-write"), run = "calibration-write"; mkdirSync(workspace, { recursive: true }); writeFileSync(join(workspace, "sample.js"), "export const answer = 42;\n");
  execFileSync("git", ["init", "-q", workspace], { windowsHide: true });
  try { const result = await executeCodex(gateway, workspace, run, "Change the exported answer in sample.js from 42 to 43 using a local edit tool. Verify the saved file and finish. Do not access network or secrets.", false, 90); const wrote = readFileSync(join(workspace, "sample.js"), "utf8").includes("43"); save(join(OUTPUT, "calibration-write.json"), { result, wrote, calls: gateway.calls, totals: providerTotals(gateway.calls) }); return { ...result, wrote, permission_context: gateway.calls.map(call => call.permission_context), tools: gateway.calls[0]?.tools }; }
  finally { gateway.close(); }
}
async function executeClaude(workspace: string, run: string, prompt: string, cm: boolean, seconds: number, model: string) {
  const directory = join(OUTPUT, "runs", run); mkdirSync(directory, { recursive: true });
  const mcp = join(directory, "mcp.json"); save(mcp, { mcpServers: cm ? { cm_eval: { type: "stdio", command: NODE, args: mcpArgs(workspace, run) } } : {} });
  if (cm) { mkdirSync(join(workspace, ".claude/skills/code-memory"), { recursive: true }); writeFileSync(join(workspace, ".claude/skills/code-memory/SKILL.md"), skill("cm_eval")); }
  const env = { ...baseEnv(), DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_GIT_BASH_PATH: "C:/Program Files/Git/bin/bash.exe" };
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", model, "--effort", "low", "--no-session-persistence", "--strict-mcp-config", "--mcp-config", mcp, "--setting-sources", "project", "--permission-mode", "acceptEdits", "--tools", "Read,Edit,Write,Glob,Grep,Bash,Skill", "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash,Skill,mcp__cm_eval__cm_retrieve_context,mcp__cm_eval__cm_project_status", "--max-budget-usd", "0.75"];
  const started = performance.now(), child = spawn(CLAUDE, args, { cwd: workspace, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", timedOut = false; child.stdout.on("data", x => { stdout += x; }); child.stderr.on("data", x => { stderr += x; }); child.stdin.end(prompt);
  const timer = setTimeout(() => { timedOut = true; stopTree(child); }, seconds * 1000);
  const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); }); clearTimeout(timer);
  const elapsed_ms = performance.now() - started; writeFileSync(join(directory, "events.jsonl"), stdout); writeFileSync(join(directory, "stderr.txt"), stderr);
  const events = stdout.split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }), final = [...events].reverse().find(e => e.type === "result");
  const usage = final?.usage, input = usage ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0, output = usage?.output_tokens ?? 0;
  return { code, timed_out: timedOut, elapsed_ms, native_usage: usage ?? null, model_usage: final?.modelUsage ?? null, resolved_models: Object.keys(final?.modelUsage ?? {}), cm_calls: events.filter(e => e.type === "assistant").flatMap(e => e.message?.content ?? []).filter(c => c.type === "tool_use" && c.name?.endsWith("cm_retrieve_context")).length, completed: final?.subtype === "success" && !final?.is_error, result_subtype: final?.subtype, permission_denials: final?.permission_denials ?? [], usage: { input, output, total: input + output, cache_read: usage?.cache_read_input_tokens ?? 0, cache_write: usage?.cache_creation_input_tokens ?? 0, missing: usage ? 0 : 1, usd_estimate: final?.total_cost_usd ?? null }, event_types: [...new Set(events.map(e => e.type))] };
}
export async function probeClaude() {
  const workspace = join(WORK, "calibration-claude"); mkdirSync(workspace, { recursive: true }); writeFileSync(join(workspace, "sample.js"), "export const answer = 42;\n");
  const result = await executeClaude(workspace, "calibration-claude", "Read sample.js with a local tool, then report its exported value. Do not modify files or access network/secrets.", false, 90, "sonnet");
  save(join(OUTPUT, "calibration-claude.json"), result); return result;
}
export async function probeClaudeWrite() {
  const run = "calibration-claude-write", workspace = join(WORK, run); mkdirSync(workspace, { recursive: true }); writeFileSync(join(workspace, "sample.js"), "export const answer = 42;\n");
  execFileSync("git", ["init", "-q", workspace], { windowsHide: true });
  const result = await executeClaude(workspace, run, "Change the exported answer in sample.js from 42 to 43 using a local edit tool. Verify the saved file and finish. Do not access network or secrets.", false, 90, "claude-sonnet-5-5");
  const wrote = readFileSync(join(workspace, "sample.js"), "utf8").includes("43"); save(join(OUTPUT, run + ".json"), { ...result, wrote }); return { ...result, wrote };
}
export async function probeClaudeCM() {
  const run = "calibration-claude-cm", workspace = join(WORK, run); cpSync(join(OUTPUT, "corpus"), workspace, { recursive: true });
  const result = await executeClaude(workspace, run, "Use the CM retrieval tool to read game/src/core/reward-wallet.js, then name its exported function. Do not edit files or run other tools.", true, 120, "claude-sonnet-5-5");
  save(join(OUTPUT, run + ".json"), result); return result;
}
export async function probeCM(key: string) {
  const gateway = gatewayFor(key); await gateway.start(); const workspace = join(WORK, "calibration-cm"); cpSync(join(OUTPUT, "corpus"), workspace, { recursive: true });
  try { const result = await executeCodex(gateway, workspace, "calibration-cm", "Use the CM retrieval tool to read game/src/core/reward-wallet.js, then name its exported function. Do not edit files or run other tools.", true, 120); save(join(OUTPUT, "calibration-cm.json"), { result, calls: gateway.calls, totals: providerTotals(gateway.calls) }); return result; }
  finally { gateway.close(); }
}
export async function runClientAB(key: string, client = "codex") {
  const protocol = read(join(OUTPUT, "protocol.json")), preparation = read(join(OUTPUT, "preparation.json")), tasks: Task[] = read(join(ROOT, "evaluation/clients/cases.json"));
  if (hash(JSON.stringify(tasks)) !== protocol.tasks_hash || hash(readFileSync(join(ROOT, "dist/scripts/client_checks.js"))) !== protocol.grader_hash) throw Error("Frozen tasks/grader changed");
  const gateway = gatewayFor(key); await gateway.start(); const results: any[] = [];
  try {
    for (let rep = 1; rep <= protocol.repetitions; rep++) for (const [position, task] of tasks.entries()) for (const arm of (position + rep) % 2 ? ["cm", "none"] : ["none", "cm"]) {
      const run = "run-" + hash(client + ":" + task.id + ":" + rep + ":" + arm).slice(0, 16), workspace = join(WORK, run), setupStart = performance.now(); if (existsSync(workspace)) throw Error("Preserve previous run workspace");
      cpSync(preparation.corpus, workspace, { recursive: true });
      execFileSync("git", ["init", "-q", workspace], { windowsHide: true });
      const setup_ms = performance.now() - setupStart; save(join(OUTPUT, "progress-" + client + ".json"), { state: "running", task: task.id, rep, arm, completed: results.length, planned: tasks.length * protocol.repetitions * 2 });
      if (providerTotals(gateway.calls).usd_estimate >= protocol.usd_guard) throw Error("Experiment cost guard reached");
      const response = client === "codex" ? await executeCodex(gateway, workspace, run, task.prompt + protocol.prompt_suffix, arm === "cm", protocol.max_seconds) : await executeClaude(workspace, run, task.prompt + protocol.prompt_suffix, arm === "cm", protocol.max_seconds, protocol.model.claude);
      const calls = gateway.calls.filter(call => call.run === run), usage = client === "codex" ? providerTotals(calls) : (response as Awaited<ReturnType<typeof executeClaude>>).usage, gradeStarted = performance.now();
      let quality: any; try { quality = JSON.parse(execFileSync(NODE, [join(ROOT, "dist/scripts/client_checks.js"), workspace, preparation.corpus, task.id], { env: baseEnv(), encoding: "utf8", windowsHide: true, timeout: 60000 })); } catch (error) { const output = (error as { stdout?: string }).stdout; quality = output ? JSON.parse(output) : { pass: false, error: "External grader failed" }; }
      let regressions = false; try { execFileSync(NODE, ["--test", "tests/ads-rewards.test.mjs", "tests/economy.test.mjs", "tests/geo-shared.test.mjs"], { cwd: workspace, env: baseEnv(), windowsHide: true, timeout: 30000, stdio: "pipe" }); regressions = true; } catch {}
      const scope_changes = preparation.files.filter((f: any) => !task.allowed.includes(f.path) && (!existsSync(join(workspace, f.path)) || hash(readFileSync(join(workspace, f.path))) !== f.sha256)).map((f: any) => f.path);
      const result = { client, task: task.id, category: task.category, rep, arm, run, setup_ms, ...response, usage, calls, quality, regressions, grade_ms: performance.now() - gradeStarted, scope_changes, success: response.completed && response.code === 0 && quality.pass && regressions && !scope_changes.length };
      results.push(result); save(join(OUTPUT, "results-" + client + ".json"), results); save(join(OUTPUT, "progress-" + client + ".json"), { state: "running", completed: results.length, planned: tasks.length * protocol.repetitions * 2, latest: { task: task.id, arm, success: result.success, tokens: usage.total, seconds: response.elapsed_ms / 1000, cm_calls: response.cm_calls } });
      console.log(JSON.stringify({ phase: "run", client, completed: results.length, task: task.id, arm, success: result.success, tokens: usage.total, seconds: response.elapsed_ms / 1000, cm_calls: response.cm_calls }));
    }
    save(join(OUTPUT, "progress-" + client + ".json"), { state: "complete", completed: results.length, planned: results.length }); return { client, completed: results.length };
  } finally { gateway.close(); }
}
if (process.argv[1]?.endsWith("client_ab.js")) {
  const action = process.argv[2];
  if (action === "prepare") console.log(JSON.stringify(await prepareClientAB()));
  else if (action === "probe-claude") console.log(JSON.stringify(await probeClaude()));
  else if (action === "probe-claude-write") console.log(JSON.stringify(await probeClaudeWrite()));
  else if (action === "probe-claude-cm") console.log(JSON.stringify(await probeClaudeCM()));
  else if (action === "run" && process.argv[3] === "claude") console.log(JSON.stringify(await runClientAB("", "claude")));
  else {
    const lines = createInterface({ input: process.stdin }); const key: string = await new Promise(resolve => lines.once("line", value => { lines.close(); resolve(value); }));
    if (!key.startsWith("sk-")) throw Error("API key must be provided on stdin");
    if (action === "run-both") {
      const calibration = await probeCM(key); console.log(JSON.stringify({ phase: "calibration-cm", ...calibration }));
      if (!calibration.completed || calibration.timed_out || calibration.code !== 0 || !calibration.cm_calls) throw Error("Native Codex CM preflight failed; primary sequence not started");
      console.log(JSON.stringify(await runClientAB(key, "claude")));
      console.log(JSON.stringify(await runClientAB(key, "codex")));
    } else console.log(JSON.stringify(action === "probe" ? await probeCodex(key) : action === "probe-cm" ? await probeCM(key) : action === "probe-write" ? await probeWrite(key) : await runClientAB(key, process.argv[3])));
  }
}
