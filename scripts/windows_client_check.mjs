// Starts a real client once in the project with a placeholder key and reports whether it ran the CM UserPromptSubmit hook.
// The model call fails or retries, but the hook runs before it, so CM_HOOK_LOG records the run. The client is stopped
// after a minute. Usage: node scripts/windows_client_check.mjs codex|claude <project> <hook log>
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const [client, project, log] = process.argv.slice(2);
rmSync(log, { force: true });
const prompt = '"Make cartTotal ignore items whose qty is negative."';
const command = client === "codex" ? `codex exec --skip-git-repo-check --dangerously-bypass-hook-trust ${prompt}` : `claude -p ${prompt} --setting-sources project`;
const result = spawnSync(command, { cwd: project, shell: true, input: "", encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", env: { ...process.env, CM_HOOK_LOG: log } });
console.log(`${client}: exit ${result.status}${result.error ? " (" + result.error.message + ")" : ""}`);
const output = ((result.stdout ?? "") + (result.stderr ?? "")).trim().split("\n");
console.log([...output.filter(line => /hook/i.test(line)).slice(0, 20), ...output.slice(-4)].join("\n"));
// The hook log needs CM_HOOK_LOG, which a client may not pass to hooks; the session transcript shows what the model received.
const entries = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
const logged = entries.find(entry => entry.paths?.length);
const walk = dir => existsSync(dir) ? readdirSync(dir).flatMap(name => { const path = join(dir, name);return statSync(path).isDirectory() ? walk(path) : name.endsWith(".jsonl") ? [path] : []; }) : [];
const transcripts = client === "codex" ? walk(join(process.env.CODEX_HOME ?? "", "sessions")) : walk(join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude", "projects"));
const inTranscript = transcripts.some(path => readFileSync(path, "utf8").includes("CM context (current saved source"));
console.log(`hook log entry: ${logged ? `${logged.via}, ${logged.bytes} bytes, ${logged.paths.join(", ")}` : "none"}; CM context in the ${client} session transcript: ${inTranscript} (${transcripts.length} files)`);
console.log(logged || inTranscript ? `HOOK RAN: ${client} delivered CM context` : `HOOK NOT RUN: ${client}`);
process.exitCode = logged || inTranscript ? 0 : 1;
