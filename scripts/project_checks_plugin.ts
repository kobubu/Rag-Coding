import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";

export const name = "optimization-project-checks";
export const inject = ["tools"];
type Config = { node: string; script: string; task: string; workspace: string; baseline: string };
const execute = promisify(execFile);
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({ name: "project_checks", description: "Run the fixed public behavior/performance smoke for the current optimization. Returns correctness and CPU timing; this is a smoke, separate final checks follow. No arbitrary command.",
    parameters: {}, output: { schema: { type: "object", additionalProperties: true }, render: (_args: unknown, value: unknown) => [{ type: "text" as const, text: JSON.stringify(value) }] },
    async execute(_args, exec) {
      const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      try {
        const result = await execute(config.node, [config.script, config.workspace, config.baseline, config.task, "--public"],
          { cwd: config.workspace, env, timeout: 25000, maxBuffer: 65536, windowsHide: true, signal: exec.signal });
        return JSON.parse(result.stdout) as Record<string, JsonValue>;
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string };
        if (failure.stdout) { try { return JSON.parse(failure.stdout) as Record<string, JsonValue>; } catch { /* Report bounded diagnostics below. */ } }
        return { pass: false, error: (failure.stderr ?? failure.message ?? "Checks failed").slice(0, 2500) };
      }
    },
  }));
}
