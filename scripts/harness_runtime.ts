import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import * as plugin from "../src/harness/plugin.js";
import type { Config } from "../src/harness/plugin.js";

export async function mountHarnessPlugin(config: Config) {
  const ctx = new Context();
  const promptFiber = await ctx.plugin(SystemPrompt, {});
  const toolsFiber = await ctx.plugin(ToolRuntime, {});
  const pluginFiber = await ctx.plugin(plugin, config);
  let counter = 0;
  return {
    ctx, pluginFiber,
    call(name: string, args: unknown, signal = new AbortController().signal) {
      return ctx.tools.execute({ callId: ToolCallId(`cm-smoke-${++counter}`), name, arguments: args, signal });
    },
    async close() {
      await pluginFiber.dispose();
      await toolsFiber.dispose();
      await promptFiber.dispose();
    },
  };
}
