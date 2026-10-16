#!/usr/bin/env node
// UserPromptSubmit hook for Codex and Claude Code: adds CM source context before the agent's first model call,
// the native-client counterpart of the Harness plugin's auto context.
import { agentOptions } from "../local-agent/config.js";
import { LocalCM } from "../local-agent/service.js";
import { renderContext } from "../code-memory/retrieve.js";
import { appendFileSync } from "node:fs";

import { hookOutput } from "./context.js";

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input || "{}") as { prompt?: unknown };
  const prompt = typeof event.prompt === "string" ? event.prompt.slice(0, 16000) : "";
  if (!prompt.trim()) return;
  const service = new LocalCM(agentOptions(process.argv.slice(2)));
  try {
    const started = performance.now(), context = await service.retrieve(prompt, 6000, AbortSignal.timeout(60000));
    process.stdout.write(hookOutput(renderContext(context, false)));
    // Optional diagnostics without source text, so an evaluation can prove the context was delivered.
    if (process.env.CM_HOOK_LOG) appendFileSync(process.env.CM_HOOK_LOG, JSON.stringify({ at: new Date().toISOString(), ms: Math.round(performance.now() - started), bytes: context.bytes_used,
      paths: [...new Set(context.parts.map(part => part.path))], route: context.retrieval?.route ?? "current-file", omissions: context.omissions }) + "\n");
  } catch (error) {
    // A missing or stale index must not block the user's prompt; the agent continues with its own tools.
    process.stderr.write("CM hook: " + (error instanceof Error ? error.message : String(error)) + "\n");
  } finally { service.close(); }
}

await main();
