// Starts a real client once in the project with a placeholder key and reports whether it ran the CM UserPromptSubmit hook.
// The model call fails or retries, but the hook runs before it, so CM_HOOK_LOG records the run. The client is stopped
// after a minute. Usage: node scripts/windows_client_check.mjs codex|claude <project> <hook log>
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const [client, project, log] = process.argv.slice(2);
rmSync(log, { force: true });
const prompt = '"Make cartTotal ignore items whose qty is negative."';
const command = client === "codex" ? `codex exec --skip-git-repo-check --dangerously-bypass-hook-trust ${prompt}` : `claude -p ${prompt} --setting-sources project`;
const result = spawnSync(command, { cwd: project, shell: true, input: "", encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", env: { ...process.env, CM_HOOK_LOG: log } });
console.log(`${client}: exit ${result.status}${result.error ? " (" + result.error.message + ")" : ""}`);
console.log(((result.stdout ?? "") + (result.stderr ?? "")).trim().split("\n").slice(-6).join("\n"));
const entries = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
const delivered = entries.find(entry => entry.paths?.length);
console.log(delivered ? `HOOK RAN: ${client} delivered CM context (${delivered.via}, ${delivered.bytes} bytes, ${delivered.paths.join(", ")})` : `HOOK NOT RUN: ${client}`);
process.exitCode = delivered ? 0 : 1;
