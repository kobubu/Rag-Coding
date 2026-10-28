import { resolve } from "node:path";
import { ARMS, freezeProtocol, prepareEfficiencyAB, runEfficiencyAB } from "./efficiency_ab.js";
import type { Arm } from "./efficiency_ab.js";
const args = new Map<string, string>(), allowed = new Set(["--phase", "--project", "--out", "--node", "--harness", "--cases", "--model-cache", "--reuse-cache", "--base-plugin", "--arms", "--repetitions", "--protocol", "--budget", "--corpus-glob"]);
for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i]!, value = process.argv[i + 1]; if (!allowed.has(key) || !value || value.startsWith("--") || args.has(key)) throw Error("Invalid benchmark option " + key); args.set(key, value); }
const required = (name: string) => { const value = args.get(name); if (!value) throw Error("Missing " + name); return value; };
const phase = required("--phase"), repetitions = Number(args.get("--repetitions") ?? 2), arms = (args.get("--arms") ?? ARMS.join(",")).split(",") as Arm[];
if (!["prepare", "freeze", "run"].includes(phase) || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5 || !arms.length || arms.some(a => !ARMS.includes(a))) throw Error("Invalid phase/repetitions/arms");
const options = { project: resolve(required("--project")), output: resolve(required("--out")), node: process.execPath, harness: resolve(required("--harness")), cases: resolve(required("--cases")), modelCache: resolve(required("--model-cache")),
  reuseCache: resolve(required("--reuse-cache")), basePlugin: resolve(required("--base-plugin")), arms, budgetUsd: Number(args.get("--budget") ?? 2), model: "gpt-6-luna",
  apiKey: phase === "run" ? process.env.CM_AB_API_KEY ?? process.env.OPENAI_API_KEY ?? "" : "", repetitions, maxCalls: 12, maxSeconds: 240, ...(args.has("--corpus-glob") ? { corpusGlob: args.get("--corpus-glob")! } : {}) };
if (phase === "run" && !options.apiKey) throw Error("Missing in-memory credential");
console.log(JSON.stringify(phase === "prepare" ? await prepareEfficiencyAB(options) : phase === "freeze" ? freezeProtocol(options) : await runEfficiencyAB(options, resolve(required("--protocol")))));
