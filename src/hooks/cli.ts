#!/usr/bin/env node
// UserPromptSubmit hook for Codex and Claude Code: adds CM source context before the agent's first model call,
// the native-client counterpart of the Harness plugin's auto context. A warm per-project daemon answers when it is
// running; otherwise the hook answers in-process and starts the daemon for the next prompt (CM_HOOK_DAEMON=off disables it).
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentOptions } from "../local-agent/config.js";
import { hookOutput } from "./context.js";
import { ask, daemonAddress } from "./client.js";
import type { HookReply } from "./client.js";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input || "{}") as { prompt?: unknown };
  const prompt = typeof event.prompt === "string" ? event.prompt.slice(0, 16000) : "";
  if (!prompt.trim()) return;
  const args = process.argv.slice(2), config = agentOptions(args), started = performance.now(), daemon = process.env.CM_HOOK_DAEMON !== "off";
  let reply: HookReply, via = "daemon";
  try {
    const address = daemonAddress(config);
    try {
      if (!daemon) throw new Error("daemon disabled");
      reply = await ask(address, prompt);
    } catch {
      via = "process";
      const [{ LocalCM }, { answer }] = await Promise.all([import("../local-agent/service.js"), import("./daemon.js")]);
      const service = new LocalCM({ ...config, backgroundUpdate: false });
      try { reply = await answer(service, prompt); } finally { service.close(); }
      if (daemon) spawn(process.execPath, [fileURLToPath(new URL("./daemon_cli.js", import.meta.url)), ...args], { detached: true, stdio: "ignore" }).unref();
    }
    process.stdout.write(hookOutput(reply.text));
    // Optional diagnostics without source text, so an evaluation can prove the context was delivered.
    if (process.env.CM_HOOK_LOG) appendFileSync(process.env.CM_HOOK_LOG, JSON.stringify({ at: new Date().toISOString(), via, ms: Math.round(performance.now() - started), retrieve_ms: reply.ms,
      bytes: reply.bytes, paths: reply.paths, route: reply.route, omissions: reply.omissions }) + "\n");
  } catch (error) {
    // A missing or stale index must not block the user's prompt; the agent continues with its own tools.
    process.stderr.write("CM hook: " + (error instanceof Error ? error.message : String(error)) + "\n");
  }
}

await main();
