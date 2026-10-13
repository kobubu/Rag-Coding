import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCorpus, prepareCases, runBenchmark } from "./harness_ab.js";
import type { ABCase, ABOptions } from "./harness_ab.js";
import { buildVectors } from "../src/code-memory/vector.js";
import { validateIndex } from "../src/code-memory/store.js";

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key || !["--project", "--output", "--harness", "--cases", "--oracle", "--cm-mode", "--model-cache"].includes(key) || !value || value.startsWith("--") || values.has(key)) {
    throw new Error("Usage: run_harness_ab --project path --output new-directory --harness bin.js --cases cases.json --oracle checks.mjs");
  }
  values.set(key, value);
}
for (const key of ["--project", "--output", "--harness", "--cases", "--oracle"]) if (!values.has(key)) throw new Error("Missing " + key);
const apiKey = process.env.CM_AB_API_KEY?.trim();
if (!apiKey) throw new Error("Set CM_AB_API_KEY in the process environment; no credential is stored in the experiment files");
const cases: ABCase[] = JSON.parse(readFileSync(resolve(values.get("--cases")!), "utf8"));
const oracle = resolve(values.get("--oracle")!);
const cmMode = values.get("--cm-mode") ?? "legacy";
if (cmMode !== "legacy" && cmMode !== "compact") throw new Error("--cm-mode must be legacy or compact");
const modelCache = resolve(values.get("--model-cache") ?? values.get("--output")! + "/model-cache");
const options: ABOptions = { project: resolve(values.get("--project")!), output: resolve(values.get("--output")!),
  harness: resolve(values.get("--harness")!), node: process.execPath, apiKey, model: "gpt-6-luna", cmMode,
  modelCache };
createCorpus(options);
prepareCases(options, cases, oracle);
if (cmMode === "compact") {
  const measurements = [];
  for (const task of cases) {
    const workspace = resolve(options.output, "prepared", task.id);
    const index = validateIndex(JSON.parse(readFileSync(workspace + "/.code-memory/index.json", "utf8")));
    measurements.push({ task: task.id, ...await buildVectors(index, { directory: workspace + "/.code-memory/vectors",
      modelCache, allowDownload: true, embeddingCache: options.output + "/embedding-cache.json" }) });
    writeFileSync(options.output + "/indexing.json", JSON.stringify(measurements, null, 2));
  }
}
console.log(JSON.stringify(await runBenchmark(options, cases, oracle)));
