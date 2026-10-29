// Runs the hook commands that cm-setup wrote into a project through the shells Windows clients use, and reports whether each
// returned CM context. Codex runs hooks in the session's PowerShell (pwsh -NoProfile -Command) or, without one, %COMSPEC% /C
// with the command in one extra pair of quotes; Claude Code runs them in Git Bash, cmd.exe as fallback.
// Usage: node scripts/windows_hook_check.mjs <project>
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const project = process.argv[2];
const toml = readFileSync(join(project, ".codex/config.toml"), "utf8");
const codex = JSON.parse([...toml.matchAll(/^command = (".*")$/gm)].pop()[1]);
const claude = JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command;
const input = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "windows-check", prompt: "cartTotal must ignore items with a negative qty", cwd: project });
const gitBash = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(path => existsSync(path));
const comspec = process.env.ComSpec ?? "cmd.exe";
const cases = [
  ["codex", "PowerShell 7 session (pwsh -NoProfile -Command)", "pwsh", ["-NoProfile", "-Command", codex], false],
  ["codex", "Windows PowerShell 5.1 session", "powershell", ["-NoProfile", "-Command", codex], false],
  ["codex", "no session shell: %COMSPEC% /C \"<command>\"", comspec, ['/C "' + codex + '"'], true],
  ["codex", "%COMSPEC% /C <command>", comspec, ["/C " + codex], true],
  ["claude", "Git Bash (bash -c)", gitBash, ["-c", claude], false],
  ["claude", "cmd.exe fallback: %COMSPEC% /C <command>", comspec, ["/C " + claude], true],
];
let failed = 0;
for (const [client, shell, program, args, verbatim] of cases) {
  if (!program) { console.log(`SKIP ${client} | ${shell}: not installed`); continue; }
  const result = spawnSync(program, args, { input, encoding: "utf8", windowsVerbatimArguments: verbatim, timeout: 120000, env: { ...process.env, CM_HOOK_DAEMON: "off" } });
  let ok = false;
  try { ok = JSON.parse(result.stdout).hookSpecificOutput.additionalContext.includes("CM context"); } catch { /* reported below */ }
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${client} | ${shell} | exit ${result.status} | ${ok ? "CM context returned" : (result.stderr || result.stdout || String(result.error)).slice(0, 300).replace(/\s+/g, " ")}`);
}
console.log(`codex command: ${codex}\nclaude command: ${claude}`);
process.exitCode = failed ? 1 : 0;
