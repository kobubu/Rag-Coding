#!/usr/bin/env node
// UserPromptSubmit hook for Codex and Claude Code: adds CM source context before the agent's first model call,
// the native-client counterpart of the Harness plugin's auto context. A warm per-project daemon answers when it is
// running; otherwise the hook answers in-process and starts the daemon for the next prompt (CM_HOOK_DAEMON=off disables it).
// As a PreToolUse hook it answers the first re-read of an unchanged file the context showed whole with a pointer.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentOptions } from "../local-agent/config.js";
import { contextLimit, hookOutput } from "./context.js";
import type { HookClient } from "./context.js";
import { ask, daemonAddress } from "./client.js";
import type { HookReply } from "./client.js";
import { preToolOutput, rememberDelivered, rereadPointer } from "./reread.js";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input || "{}") as { prompt?: unknown; hook_event_name?: string; session_id?: unknown; tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  const session = typeof event.session_id === "string" ? event.session_id : "";
  if (event.hook_event_name === "PreToolUse") {
    try {
      const reason = rereadPointer(session, String(event.tool_name ?? ""), event.tool_input, typeof event.cwd === "string" ? event.cwd : process.cwd());
      if (reason) {
        process.stdout.write(preToolOutput(reason));
        if (process.env.CM_HOOK_LOG) appendFileSync(process.env.CM_HOOK_LOG, JSON.stringify({ at: new Date().toISOString(), event: "reread_pointer", tool: event.tool_name }) + "\n");
      }
    } catch (error) { process.stderr.write("CM hook: " + (error instanceof Error ? error.message : String(error)) + "\n"); }
    return;
  }
  const prompt = typeof event.prompt === "string" ? event.prompt.slice(0, 16000) : "";
  if (!prompt.trim()) return;
  // --client selects the client-specific wording; it is not a CM option, so the daemon and its address never see it.
  const argv = process.argv.slice(2), at = argv.indexOf("--client"), client = (at >= 0 ? argv[at + 1] : "codex") as HookClient;
  if (client !== "codex" && client !== "claude") throw new Error("--client must be codex or claude");
  const args = at >= 0 ? [...argv.slice(0, at), ...argv.slice(at + 2)] : argv;
  const config = agentOptions(args), started = performance.now(), daemon = process.env.CM_HOOK_DAEMON !== "off";
  let reply: HookReply, via = "daemon";
  try {
    const address = daemonAddress(config);
    try {
      if (!daemon) throw new Error("daemon disabled");
      reply = await ask(address, prompt, 65000, contextLimit(client));
    } catch {
      via = "process";
      const [{ LocalCM }, { answer }] = await Promise.all([import("../local-agent/service.js"), import("./daemon.js")]);
      const service = new LocalCM({ ...config, backgroundUpdate: false });
      try { reply = await answer(service, prompt, contextLimit(client)); } finally { service.close(); }
      if (daemon) spawn(process.execPath, [fileURLToPath(new URL("./daemon_cli.js", import.meta.url)), ...args], { detached: true, stdio: "ignore" }).unref();
    }
    process.stdout.write(hookOutput(reply.text, client));
    rememberDelivered(session, config.projectRoot, reply.whole ?? []);
    // Optional diagnostics without source text, so an evaluation can prove the context was delivered.
    if (process.env.CM_HOOK_LOG) appendFileSync(process.env.CM_HOOK_LOG, JSON.stringify({ at: new Date().toISOString(), via, ms: Math.round(performance.now() - started), retrieve_ms: reply.ms,
      bytes: reply.bytes, paths: reply.paths, route: reply.route, omissions: reply.omissions }) + "\n");
  } catch (error) {
    // A missing or stale index must not block the user's prompt; the agent continues with its own tools.
    process.stderr.write("CM hook: " + (error instanceof Error ? error.message : String(error)) + "\n");
  }
}

await main();
