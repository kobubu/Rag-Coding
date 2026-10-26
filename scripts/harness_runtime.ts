import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import * as plugin from "../src/harness/plugin.js";
import type { Config } from "../src/harness/plugin.js";

export async function mountHarnessPlugin(config: Config) {
  const ctx = new Context();
  const promptFiber = await ctx.plugin(SystemPrompt, {});
  const toolsFiber = await ctx.plugin(ToolRuntime, {});
  const fsFiber = await ctx.plugin(LocalFileSystem, { cwd: config.projectRoot ?? process.cwd() });
  const pluginFiber = await ctx.plugin(plugin, config);
  let counter = 0;
  return {
    ctx, pluginFiber,
    call(name: string, args: unknown, signal = new AbortController().signal, agent?: Agent) {
      return ctx.tools.execute({ callId: ToolCallId(`cm-smoke-${++counter}`), name, arguments: args, signal, ...(agent ? { agent } : {}) });
    },
    step(agent: Agent, messages: Extract<PreStepDecision, { kind: "enter" }>["messages"], signal = new AbortController().signal,
      decision: PreStepDecision = { kind: "enter", messages }) {
      return ctx.waterfall("agent/pre-step", { agent, messages, turn: 1, step: 1, signal }, async () => decision);
    },
    async close() {
      await pluginFiber.dispose();
      await fsFiber.dispose();
      await toolsFiber.dispose();
      await promptFiber.dispose();
    },
  };
}
