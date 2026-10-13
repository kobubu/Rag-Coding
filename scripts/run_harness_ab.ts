import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCorpus, prepareCases, runBenchmark } from "./harness_ab.js";
import type { ABCase } from "./harness_ab.js";

const args = process.argv.slice(2);
const values = new Map<string, string>();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!key || !["--project", "--output", "--harness", "--cases", "--oracle"].includes(key) || !value || value.startsWith("--") || values.has(key)) {
    throw new Error("Usage: run_harness_ab --project path --output new-directory --harness bin.js --cases cases.json --oracle checks.mjs");
  }
  values.set(key, value);
}
for (const key of ["--project", "--output", "--harness", "--cases", "--oracle"]) if (!values.has(key)) throw new Error("Missing " + key);
const apiKey = process.env.CM_AB_API_KEY?.trim();
if (!apiKey) throw new Error("Set CM_AB_API_KEY in the process environment; no credential is stored in the experiment files");
const cases: ABCase[] = JSON.parse(readFileSync(resolve(values.get("--cases")!), "utf8"));
const oracle = resolve(values.get("--oracle")!);
const options = { project: resolve(values.get("--project")!), output: resolve(values.get("--output")!),
  harness: resolve(values.get("--harness")!), node: process.execPath, apiKey, model: "gpt-6-luna" };
createCorpus(options);
prepareCases(options, cases, oracle);
console.log(JSON.stringify(await runBenchmark(options, cases, oracle)));
