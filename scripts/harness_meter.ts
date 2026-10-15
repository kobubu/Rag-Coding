import type { Context } from "@deepseek-ai/cordis";
import type { TokenUsage } from "@deepseek-ai/dsh-llm";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

export const name = "cm-ab-meter";
export const inject = ["llm"];

export type MeterConfig = { output: string; model: string; maxCalls?: number; requireCMContext?: boolean };

export function apply(ctx: Context, config: MeterConfig): void {
  const calls: { call: number; model: string; started_at_ms: number; duration_ms: number; usage: TokenUsage | null; finish: string | null; cm_tools: string[]; cm_context_present: boolean; request_bytes: number; schema_bytes: number; cm_context_occurrences: number }[] = [];
  let attempts = 0;
  ctx.on("llm/stream", (options, next) => {
    if (options.model !== config.model) throw new Error("AB experiment refuses a different model");
    const call = ++attempts;
    if (call > (config.maxCalls ?? 12)) throw new Error("AB model-call limit reached");
    const cmTools = (options.tools ?? []).filter((tool) => tool.name.startsWith("cm_")).map((tool) => tool.name);
    const cmContext = /CM context \((?:partial; source version checked|current saved source, version checked and registered as read for edit)\)/.test(JSON.stringify(options.messages));
    const messages = JSON.stringify(options.messages), requestBytes = Buffer.byteLength(messages, "utf8"), schemaBytes = Buffer.byteLength(JSON.stringify(options.tools ?? []), "utf8");
    const cmOccurrences = [...messages.matchAll(/CM context \((?:partial; source version checked|current saved source, version checked and registered as read for edit)\)/g)].length;
    if (call === 1 && config.requireCMContext && (!cmTools.includes("cm_retrieve_context") || !cmContext)) {
      throw new Error("AB refuses a paid call: compact CM tool/context did not activate");
    }
    const started = performance.now(), startedAt = Date.now();
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
        calls.push({ call, model: String(options.model), started_at_ms: startedAt, duration_ms: performance.now() - started, usage, finish, cm_tools: cmTools, cm_context_present: cmContext,
          request_bytes: requestBytes, schema_bytes: schemaBytes, cm_context_occurrences: cmOccurrences });
        writeFileSync(config.output, JSON.stringify({ accounting: "Provider-reported disjoint token usage; no heuristic estimates", attempts, calls }, null, 2));
      }
    })();
  });
}
