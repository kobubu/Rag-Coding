import { resolve } from "node:path";
import { prepareOptimization, runOptimization } from "./optimization_ab.js";
import type { OptimizationOptions } from "./optimization_ab.js";
const values = new Map<string, string>();
const allowed = new Set(["phase", "project", "out", "node", "harness", "cases", "model", "model-cache", "embedding-cache", "repetitions"]);
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, ""), value = process.argv[i + 1];
  if (!key || !allowed.has(key) || !value || value.startsWith("--") || values.has(key)) throw new Error("Invalid or duplicate optimization argument");
  values.set(key, value);
}
const required = (key: string) => { const value = values.get(key); if (!value) throw new Error(`Missing --${key}`); return value; };
const phase = required("phase"); if (phase !== "prepare" && phase !== "run") throw new Error("--phase must be prepare or run");
const repetitions = Number(values.get("repetitions") ?? 3); if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error("Invalid --repetitions");
if (required("model") !== "gpt-6-luna") throw new Error("This optimization protocol and USD rates are pinned to gpt-6-luna");
const options: Omit<OptimizationOptions, "apiKey"> = { project: resolve(required("project")), output: resolve(required("out")),
  node: resolve(required("node")), harness: resolve(required("harness")), cases: resolve(required("cases")), model: required("model"),
  modelCache: resolve(required("model-cache")), ...(values.has("embedding-cache") ? { embeddingCache: resolve(values.get("embedding-cache")!) } : {}),
  repetitions, maxCalls: 20, maxSeconds: 300 };
if (phase === "prepare") console.log(JSON.stringify(await prepareOptimization(options)));
else {
  const apiKey = process.env.CM_AB_API_KEY; if (!apiKey) throw new Error("Set CM_AB_API_KEY in memory/environment");
  console.log(JSON.stringify(await runOptimization({ ...options, apiKey })));
}
