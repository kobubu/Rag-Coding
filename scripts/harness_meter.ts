import type { Context } from "@deepseek-ai/cordis";
import type { TokenUsage } from "@deepseek-ai/dsh-llm";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

export const name = "cm-ab-meter";
export const inject = ["llm"];

export type MeterConfig = { output: string; model: string; maxCalls?: number };

export function apply(ctx: Context, config: MeterConfig): void {
  const calls: { call: number; model: string; duration_ms: number; usage: TokenUsage | null; finish: string | null }[] = [];
  let attempts = 0;
  ctx.on("llm/stream", (options, next) => {
    if (options.model !== config.model) throw new Error("AB experiment refuses a different model");
    const call = ++attempts;
    if (call > (config.maxCalls ?? 12)) throw new Error("AB model-call limit reached");
    const started = performance.now();
    return (async function* () {
      let usage: TokenUsage | null = null;
      let finish: string | null = null;
      try {
        for await (const chunk of next()) {
          if ("usage" in chunk && chunk.usage) usage = chunk.usage;
          if (chunk.type === "finish") finish = chunk.reason.kind;
          yield chunk;
        }
      } finally {
        calls.push({ call, model: String(options.model), duration_ms: performance.now() - started, usage, finish });
        writeFileSync(config.output, JSON.stringify({ accounting: "Provider-reported disjoint token usage; no heuristic estimates", attempts, calls }, null, 2));
      }
    })();
  });
}
