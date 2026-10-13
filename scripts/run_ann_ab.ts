import { resolve } from "node:path";
import { prepareAnnAB, runAnnAB } from "./ann_ab.js";
const options = new Map<string, string>(), allowed = new Set(["--phase", "--project", "--out", "--node", "--harness", "--cases", "--model-cache", "--reuse-cache", "--repetitions"]);
for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i]!, value = process.argv[i + 1];if (!allowed.has(key) || !value || value.startsWith("--") || options.has(key)) throw Error("Invalid HNSW benchmark argument");options.set(key, value); }
const required = (name: string) => { const value = options.get(name);if (!value) throw Error("Missing " + name);return value; };
const phase = required("--phase"), repetitions = Number(options.get("--repetitions") ?? 2);if (!["prepare", "run"].includes(phase) || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) throw Error("Invalid phase/repetitions");
const config = { project: resolve(required("--project")), output: resolve(required("--out")), node: resolve(required("--node")), harness: resolve(required("--harness")),
  cases: resolve(required("--cases")), modelCache: resolve(required("--model-cache")), reuseCache: resolve(required("--reuse-cache")), model: "gpt-6-luna", apiKey: phase === "run" ? process.env.CM_AB_API_KEY ?? process.env.OPENAI_API_KEY ?? "" : "", repetitions, maxCalls: 12, maxSeconds: 240 };
if (phase === "run" && !config.apiKey) throw Error("Missing in-memory provider credential");
console.log(JSON.stringify(await (phase === "prepare" ? prepareAnnAB(config) : runAnnAB(config))));
