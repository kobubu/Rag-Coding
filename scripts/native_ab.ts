import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { hash } from "../src/code-memory/source.js";
import { ROOT } from "./lib.js";

// Three-arm A/B in a native coding client (Codex CLI or Claude Code): no CM, a frozen CM build connected the way its installer did
// (MCP server + skill), and the current build with the UserPromptSubmit hook that adds CM context before the first call.
// Tasks, prepared workspaces, vectors and the independent grader are the ones of the Harness efficiency series.
export const ARMS = ["none", "cm_base", "cm_next", "cm_warm", "cm_guard"] as const;
// cm_warm: the cm_next configuration with its hook daemon already running, as in steady-state use of a project.
const hooked = (arm: Arm) => arm === "cm_next" || arm === "cm_warm" || arm === "cm_guard";
// cm_guard: cm_warm plus the PreToolUse hook that answers the first re-read of a file the context showed whole.
const guarded = (arm: Arm) => arm === "cm_guard";
export type Arm = typeof ARMS[number];
type Task = { id: string; prompt: string; category: string; mutations: { path: string }[]; changed_paths?: string[] };
export type NativeOptions = { warmDaemon?: boolean; client: "codex" | "claude"; claude?: string; claudeModel?: string; prepared: string; output: string; cases: string; codex: string; modelCache: string; baseRoot: string; arms: Arm[]; repetitions: number; budgetUsd: number; maxSeconds: number; model: string };
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
const PRICE = { input: .10, cache_read: .01, cache_write: .125, output: .50, per: 1e6, source: "https://developers.openai.com/api/docs/models/gpt-6-luna" };
const sources = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(directory + "/" + entry.name) : entry.name.endsWith(".ts") ? [directory + "/" + entry.name] : []);
const implementation = () => [...sources("src"), "scripts/native_ab.ts", "scripts/speed_checks.ts", "scripts/holdout_checks.ts", "scripts/semver_checks.ts", "scripts/superstruct_checks.ts", "scripts/lib.ts"].sort()
  .flatMap(path => [path, "dist/" + path.replace(/\.ts$/, ".js")]).map(path => ({ path, sha256: hash(readFileSync(join(ROOT, path))) }));
const tree = (root: string): string => hash(readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)).sort().map(p => p.slice(root.length) + ":" + hash(readFileSync(p))).join("\n"));
const walk = (directory: string, prefix = ""): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(directory, e.name), prefix + e.name + "/") : [prefix + e.name]);

function grade(prepared: string, workspace: string, task: string, smoke = false) {
  const manifest = read(join(prepared, "corpus-manifest.json"));
  try { return JSON.parse(execFileSync(process.execPath, [join(ROOT, "dist/scripts/speed_checks.js"), workspace, manifest.corpus, task, ...(smoke ? ["--public"] : [])], { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH ?? "" } })); }
  catch (error) { const failure = error as { stdout?: string }; return failure.stdout ? JSON.parse(failure.stdout) : { pass: false, error: "Independent grader could not run" }; }
}

export function freezeNative(options: NativeOptions) {
  const output = resolve(options.output), protocolPath = join(output, "protocol.json");
  if (existsSync(protocolPath)) throw Error("Protocol already frozen");
  mkdirSync(output, { recursive: true });
  const tasks = read(options.cases) as Task[];
  const binary = options.client === "claude" ? options.claude! : options.codex;
  const protocol = { format: "cm-native-ab-1", created_at: new Date().toISOString(), client: options.client, client_version: execFileSync(binary, ["--version"], { encoding: "utf8" }).trim(),
    model: options.client === "claude" ? options.claudeModel : options.model, reasoning_effort: "low", arms: options.arms, repetitions: options.repetitions, cases_hash: hash(JSON.stringify(tasks)),
    preparation_sha256: hash(readFileSync(join(options.prepared, "preparation.json"))), implementation: implementation(), base_build_sha256: tree(join(options.baseRoot, "dist/src")),
    warm_daemon: Boolean(options.warmDaemon), max_run_seconds: options.maxSeconds, max_estimated_usd: options.budgetUsd, price: PRICE,
    arms_config: { none: "Client without CM", cm_base: "Frozen CM 0.8.1: MCP server + installer skill, model decides whether to call it", cm_next: "Current CM: UserPromptSubmit hook adds CM context before the first call, plus MCP server + skill", cm_warm: "cm_next with its hook daemon started before the session (start time recorded separately)", cm_guard: "cm_warm plus a PreToolUse hook answering the first re-read of a file shown whole" } };
  write(protocolPath, protocol);return protocolPath;
}

function cmArguments(options: NativeOptions, prepared: string, task: string, workspace: string, run: string) {
  return ["--project", workspace, "--index", join(prepared, "cases", task, ".code-memory/index.json"), "--vectors", join(prepared, "projections", task), "--model-cache", options.modelCache,
    "--retrieval-policy", "adaptive", "--auto-update", "true", "--memory-dir", join(run, "live"), "--embedding-cache", join(prepared, "embedding-cache.json")];
}

function codexHome(home: string, options: NativeOptions, arm: Arm, workspace: string, run: string, task: string) {
  const prepared = resolve(options.prepared), build = arm === "cm_base" ? resolve(options.baseRoot) : ROOT;
  const cmArgs = cmArguments(options, prepared, task, workspace, run);
  let config = `model = ${JSON.stringify(options.model)}\nmodel_provider = "openai_key"\nmodel_reasoning_effort = "low"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\nweb_search = "disabled"\n\n` +
    `[model_providers.openai_key]\nname = "OpenAI API key"\nbase_url = "https://api.openai.com/v1"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\n`;
  if (arm !== "none") {
    config += `\n[mcp_servers.cm_eval]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([join(build, "dist/src/mcp/cli.js"), ...cmArgs])}\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\n`;
    if (hooked(arm)) config += `\n[[hooks.UserPromptSubmit]]\n\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = ${JSON.stringify([process.execPath, join(build, "dist/src/hooks/cli.js"), ...cmArgs].map(a => JSON.stringify(a)).join(" "))}\ntimeout = 120\n`;
    if (guarded(arm)) config += `\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = ${JSON.stringify([process.execPath, join(build, "dist/src/hooks/cli.js"), ...cmArgs].map(a => JSON.stringify(a)).join(" "))}\ntimeout = 30\n`;
  }
  mkdirSync(home, { recursive: true });writeFileSync(join(home, "config.toml"), config);
}

async function runCodex(options: NativeOptions, home: string, workspace: string, prompt: string, hooks: boolean, warm: boolean) {
  const args = ["exec", "--json", "--skip-git-repo-check", ...(hooks ? ["--dangerously-bypass-hook-trust"] : []), prompt];
  const env = { ...process.env, CM_HOOK_DAEMON: warm ? "on" : "off", CM_HOOK_LOG: join(home, "..", "hook.jsonl"), CODEX_HOME: home, OPENAI_API_KEY: process.env.CM_AB_API_KEY ?? process.env.OPENAI_API_KEY ?? "", SSL_CERT_FILE: process.env.SSL_CERT_FILE ?? "/root/.ccr/ca-bundle.crt" };
  const started = performance.now();
  return await new Promise<{ exit: number | null; ms: number; stdout: string; stderr: string; timedOut: boolean }>((done, fail) => {
    const child = spawn(options.codex, args, { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true;child.kill("SIGKILL"); }, options.maxSeconds * 1000);
    child.stdout.setEncoding("utf8").on("data", (c: string) => { stdout += c; });child.stderr.setEncoding("utf8").on("data", (c: string) => { stderr += c; });
    child.on("error", error => { clearTimeout(timer);fail(error); });
    child.on("close", exit => { clearTimeout(timer);done({ exit, ms: performance.now() - started, stdout, stderr, timedOut }); });
  });
}

export function codexUsage(events: { type?: string; usage?: Record<string, number> }[]) {
  const turns = events.filter(e => e.type === "turn.completed" && e.usage);
  const sum = (key: string) => turns.reduce((total, e) => total + (e.usage![key] ?? 0), 0);
  const input = sum("input_tokens"), cacheRead = sum("cached_input_tokens"), cacheWrite = sum("cache_write_input_tokens"), output = sum("output_tokens");
  const uncached = input - cacheRead - cacheWrite;
  if (uncached < 0) throw Error("Codex usage does not reconcile");
  const usd = (uncached * PRICE.input + cacheRead * PRICE.cache_read + cacheWrite * PRICE.cache_write + output * PRICE.output) / PRICE.per;
  return { turns: turns.length, uncached_input: uncached, cache_read: cacheRead, cache_write: cacheWrite, output, total_input: input, total_tokens: input + output, usd_estimate: usd };
}


// Session variables of a parent Claude Code session; without them a child run gets its own session and no parent context.
const PARENT_SESSION = /^(CLAUDE_CODE_SESSION_ID|CLAUDE_CODE_REMOTE_SESSION_ID|CLAUDECODE|CLAUDE_CODE_CHILD_SESSION|CLAUDE_PID|CLAUDE_CODE_MESSAGING_SOCKET|CLAUDE_CODE_MESSAGING_TOKEN|CLAUDE_CODE_TEE_SDK_STDOUT|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD|CLAUDE_ADDITIONAL_DIRECTORIES|CLAUDE_CODE_SYNC_[A-Z_]+|CLAUDE_AFTER_LAST_COMPACT)$/;

function claudeConfig(run: string, options: NativeOptions, arm: Arm, cmArgs: string[], checks: string) {
  const build = arm === "cm_base" ? resolve(options.baseRoot) : ROOT, mcp = join(run, "mcp.json"), settings = join(run, "settings.json");
  write(mcp, { mcpServers: arm === "none" ? {} : { cm_eval: { command: process.execPath, args: [join(build, "dist/src/mcp/cli.js"), ...cmArgs] } } });
  const hookCommand = [process.execPath, join(build, "dist/src/hooks/cli.js"), ...cmArgs, "--client", "claude"].map(a => JSON.stringify(a)).join(" ");
  write(settings, hooked(arm) ? { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCommand, timeout: 120 }] }],
    ...(guarded(arm) ? { PreToolUse: [{ matcher: "Read|Bash", hooks: [{ type: "command", command: hookCommand, timeout: 30 }] }] } : {}) } } : {});
  const tools = ["Read", "Edit", "MultiEdit", "Write", "Grep", "Glob", "Bash(" + checks + ")", ...(arm === "none" ? [] : ["mcp__cm_eval__cm_retrieve_context"])];
  return ["--model", options.claudeModel!, "--output-format", "stream-json", "--verbose", "--setting-sources", "project", "--settings", settings, "--strict-mcp-config", "--mcp-config", mcp,
    "--permission-mode", "acceptEdits", "--allowedTools", ...tools];
}

async function runClaude(options: NativeOptions, run: string, workspace: string, prompt: string, extra: string[], warm: boolean) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !PARENT_SESSION.test(key))) as Record<string, string>;
  env.CM_HOOK_LOG = join(run, "hook.jsonl");env.CM_HOOK_DAEMON = warm ? "on" : "off";
  const started = performance.now();
  return await new Promise<{ exit: number | null; ms: number; stdout: string; stderr: string; timedOut: boolean }>((done, fail) => {
    const child = spawn(options.claude!, ["-p", prompt, ...extra], { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true;child.kill("SIGKILL"); }, options.maxSeconds * 1000);
    child.stdout.setEncoding("utf8").on("data", (c: string) => { stdout += c; });child.stderr.setEncoding("utf8").on("data", (c: string) => { stderr += c; });
    child.on("error", error => { clearTimeout(timer);fail(error); });
    child.on("close", exit => { clearTimeout(timer);done({ exit, ms: performance.now() - started, stdout, stderr, timedOut }); });
  });
}

// Claude Code reports the provider's own cost; tokens are summed from the final result event.
export function claudeUsage(events: { type?: string; usage?: Record<string, number>; total_cost_usd?: number; num_turns?: number }[]) {
  const result = [...events].reverse().find(e => e.type === "result");
  if (!result?.usage) return { turns: 0, uncached_input: 0, cache_read: 0, cache_write: 0, output: 0, total_input: 0, total_tokens: 0, usd_estimate: 0 };
  const u = result.usage, uncached = u.input_tokens ?? 0, read = u.cache_read_input_tokens ?? 0, writeTokens = u.cache_creation_input_tokens ?? 0, output = u.output_tokens ?? 0;
  return { turns: result.num_turns ?? 0, uncached_input: uncached, cache_read: read, cache_write: writeTokens, output, total_input: uncached + read + writeTokens, total_tokens: uncached + read + writeTokens + output, usd_estimate: result.total_cost_usd ?? 0 };
}

export async function runNative(options: NativeOptions, protocolPath: string) {
  const output = resolve(options.output), prepared = resolve(options.prepared), protocol = read(protocolPath), tasks = read(options.cases) as Task[];
  const resultsPath = join(output, "results.json");if (existsSync(resultsPath)) throw Error("Preserve experiment identities");
  if (hash(JSON.stringify(tasks)) !== protocol.cases_hash || JSON.stringify(implementation()) !== JSON.stringify(protocol.implementation) || tree(join(options.baseRoot, "dist/src")) !== protocol.base_build_sha256
    || hash(readFileSync(join(prepared, "preparation.json"))) !== protocol.preparation_sha256) throw Error("Frozen inputs changed");
  const manifest = read(join(prepared, "corpus-manifest.json")), arms = protocol.arms as Arm[], results: Record<string, unknown>[] = [];let cost = 0;
  for (let rep = 1; rep <= protocol.repetitions; rep++) for (const [position, task] of tasks.entries()) {
    const offset = (position + rep) % arms.length, order = [...arms.slice(offset), ...arms.slice(0, offset)];if ((position + rep) % 2) order.reverse();
    for (const arm of order) {
      if (cost >= protocol.max_estimated_usd) throw Error("Experiment cost budget reached");
      const runId = "run-" + hash(`${output}:${task.id}:${rep}:${arm}`).slice(0, 16), run = join(output, "runs", runId), workspace = join(output, "workspaces", runId);
      if (existsSync(run) || existsSync(workspace)) throw Error("Run identity exists");
      mkdirSync(run, { recursive: true });cpSync(join(prepared, "cases", task.id), workspace, { recursive: true, filter: path => !path.includes(".code-memory") });
      const checks = join(run, "project_checks");
      writeFileSync(checks, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(ROOT, "dist/scripts/speed_checks.js"))} ${JSON.stringify(workspace)} ${JSON.stringify(manifest.corpus)} ${task.id} --public\n`);chmodSync(checks, 0o755);
      const skillDir = options.client === "claude" ? ".claude/skills/code-memory" : ".agents/skills/code-memory";
      if (arm !== "none") {
        const { skill } = await import(pathToFileURL(join(arm === "cm_base" ? resolve(options.baseRoot) : ROOT, "dist/src/setup/config.js")).href) as { skill: (name: string) => string };
        mkdirSync(join(workspace, skillDir), { recursive: true });writeFileSync(join(workspace, skillDir, "SKILL.md"), skill("cm_eval"));
      }
      if (options.client === "codex") codexHome(join(run, "codex-home"), options, arm, workspace, run, task.id);
      const prompt = task.prompt + ` Apply the change only in this isolated workspace. Preserve unrelated behavior and interfaces. Use supplied source when sufficient; otherwise inspect code. The same public smoke check is available to all variants as the shell command ${checks}; separate independent final checks evaluate your patch. Finish with a brief summary.`;
      // Steady-state use: the hook daemon is already warm when the prompt arrives. Its start is measured separately.
      let daemon: ReturnType<typeof spawn> | undefined, daemonStartMs: number | null = null;
      const warm = arm === "cm_warm" || arm === "cm_guard" || arm === "cm_next" && Boolean(options.warmDaemon);
      if (warm) {
        const daemonStarted = performance.now();
        daemon = spawn(process.execPath, [join(ROOT, "dist/src/hooks/daemon_cli.js"), ...cmArguments(options, prepared, task.id, workspace, run)], { stdio: ["ignore", "pipe", "ignore"] });
        await new Promise<void>((done, fail) => { daemon!.stdout!.once("data", () => done());daemon!.once("exit", code => fail(new Error("Hook daemon exited " + code))); });
        daemonStartMs = performance.now() - daemonStarted;
      }
      const response = options.client === "codex" ? await runCodex(options, join(run, "codex-home"), workspace, prompt, hooked(arm), warm)
        : await runClaude(options, run, workspace, prompt, claudeConfig(run, options, arm, cmArguments(options, prepared, task.id, workspace, run), checks), warm);
      if (daemon) { daemon.kill("SIGTERM");await new Promise(done => daemon!.once("exit", done)); }
      writeFileSync(join(run, "events.jsonl"), response.stdout);writeFileSync(join(run, "stderr.txt"), response.stderr);
      const events = response.stdout.split("\n").filter(l => l.startsWith("{")).map(l => { try { return JSON.parse(l); } catch { return {}; } });
      // Codex: completed items; Claude Code: tool_use blocks of assistant messages, normalized to the same kinds.
      const items = options.client === "codex" ? events.filter(e => e.type === "item.completed").map(e => e.item ?? {})
        : events.filter(e => e.type === "assistant").flatMap(e => (e.message?.content ?? []).filter((c: { type?: string }) => c.type === "tool_use"))
          .map((c: { name: string; input?: { command?: string; file_path?: string; pattern?: string } }) => c.name === "Bash" ? { type: "command_execution", command: c.input?.command ?? "" }
            : c.name.startsWith("mcp__") ? { type: "mcp_tool_call" } : ["Read", "Grep", "Glob"].includes(c.name) ? { type: "command_execution", command: c.name.toLowerCase() === "read" ? "cat " + (c.input?.file_path ?? "") : "grep " + (c.input?.pattern ?? "") }
            : { type: ["Edit", "MultiEdit", "Write"].includes(c.name) ? "file_change" : c.name });
      const kinds = items.map((i: { type?: string }) => i.type ?? "unknown");
      const usage = options.client === "codex" ? codexUsage(events) : claudeUsage(events), quality = grade(prepared, workspace, task.id);
      const allowed = new Set(task.changed_paths ?? task.mutations.map(m => m.path)), originalPaths = [...manifest.files.map((f: { path: string }) => f.path), "package.json", "AGENTS.md"];
      const scope = originalPaths.filter((path: string) => !allowed.has(path) && (!existsSync(join(workspace, path)) || hash(readFileSync(join(prepared, "cases", task.id, path))) !== hash(readFileSync(join(workspace, path)))));
      const added = walk(workspace).filter(path => !originalPaths.includes(path) && !path.startsWith(skillDir + "/"));
      const commands = items.filter((i: { type?: string }) => i.type === "command_execution").map((i: { command?: string }) => i.command ?? "");
      const cmCalls = items.filter((i: { type?: string; server?: string }) => i.type === "mcp_tool_call").length;
      const hookLog = existsSync(join(run, "hook.jsonl")) ? readFileSync(join(run, "hook.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l)) : [];
      const record = { run_id: runId, task: task.id, category: task.category, repetition: rep, arm, duration_ms: response.ms, exit_code: response.exit, timed_out: response.timedOut,
        task_success: Boolean(quality.pass && !scope.length && !added.length), quality, scope_changes: scope, added_files: added, usage, items: Object.fromEntries([...new Set(kinds)].map(k => [k, kinds.filter(v => v === k).length])),
        shell_commands: commands.length, read_like_commands: commands.filter(c => /\b(cat|sed|head|tail|nl|rg|grep|find|ls)\b/.test(c)).length, cm_mcp_calls: cmCalls, hook: hookLog[0] ?? null, reread_pointers: hookLog.filter((l: { event?: string }) => l.event === "reread_pointer").length, daemon_start_ms: daemonStartMs };
      // Graded and logged: drop the workspace copy and the run's live index generations (about 92 MB each on Geo Dash).
      // Codex clones its plugin marketplace (about 100 MB) into each home; the same for every arm, not needed afterwards.
      // A Codex helper may still write there after exit, so cleanup retries and never fails the trial.
      for (const path of [workspace, join(run, "live"), join(run, "codex-home", ".tmp")]) {
        try { rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (error) { console.error("Cleanup skipped: " + path + ": " + (error as Error).message); }
      }
      results.push(record);cost += usage.usd_estimate;write(resultsPath, { protocol, estimated_cost_usd: cost, results });
      console.log(JSON.stringify({ completed: results.length, task: task.id, rep, arm, success: record.task_success, turns: usage.turns, tokens: usage.total_tokens, seconds: Math.round(response.ms) / 1000, commands: commands.length, cm_mcp: cmCalls }));
      // A spent subscription or provider quota ends sessions at once with no tokens; such a run is not a measurement.
      if (!usage.turns || !usage.total_tokens || /401|Unauthorized|invalid_api_key|usage limit|rate limit/i.test(response.stderr) || hooked(arm) && (!hookLog.length || (warm ? hookLog[0].via !== "daemon" : hookLog[0].via !== "process"))) throw Error("Provider/accounting/activation failure; retained " + runId);
    }
  }
  if (JSON.stringify(implementation()) !== JSON.stringify(protocol.implementation)) throw Error("Measured code changed during trial");
  return { completed: results.length, cost, results: resultsPath };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = new Map<string, string>();for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1]!);
  const need = (key: string) => { const value = args.get(key);if (!value) throw Error("Missing " + key);return value; };
  const arms = (args.get("--arms") ?? ARMS.join(",")).split(",") as Arm[];if (arms.some(a => !ARMS.includes(a))) throw Error("Invalid arms");
  const client = (args.get("--client") ?? "codex") as "codex" | "claude";if (client !== "codex" && client !== "claude") throw Error("Invalid client");
  const options: NativeOptions = { warmDaemon: args.get("--warm-daemon") === "true", client, ...(client === "claude" ? { claude: need("--claude"), claudeModel: args.get("--claude-model") ?? "claude-sonnet-5-5" } : {}), prepared: resolve(need("--prepared")), output: resolve(need("--out")), cases: resolve(need("--cases")), codex: client === "codex" ? resolve(need("--codex")) : "", modelCache: resolve(need("--model-cache")),
    baseRoot: resolve(need("--base-root")), arms, repetitions: Number(args.get("--repetitions") ?? 2), budgetUsd: Number(args.get("--budget") ?? 2), maxSeconds: Number(args.get("--max-seconds") ?? 300), model: "gpt-6-luna" };
  const phase = need("--phase");
  console.log(JSON.stringify(phase === "freeze" ? freezeNative(options) : await runNative(options, resolve(need("--protocol")))));
}
