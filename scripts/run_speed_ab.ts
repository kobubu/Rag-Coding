import { resolve } from "node:path";
import { prepareSpeedAB, runSpeedAB } from "./speed_ab.js";
const args=new Map<string,string>(),allowed=new Set(["--phase","--project","--out","--node","--harness","--cases","--model-cache","--reuse-cache","--previous-plugin","--repetitions"]);
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i]!,value=process.argv[i+1];if(!allowed.has(key)||!value||value.startsWith("--")||args.has(key))throw Error("Invalid benchmark option");args.set(key,value);}
const required=(name:string)=>{const value=args.get(name);if(!value)throw Error("Missing "+name);return value;};
const phase=required("--phase"),repetitions=Number(args.get("--repetitions")??2);if(!["prepare","run"].includes(phase)||!Number.isInteger(repetitions)||repetitions<1||repetitions>5)throw Error("Invalid phase/repetitions");
const options={project:resolve(required("--project")),output:resolve(required("--out")),node:resolve(required("--node")),harness:resolve(required("--harness")),cases:resolve(required("--cases")),modelCache:resolve(required("--model-cache")),reuseCache:resolve(required("--reuse-cache")),previousPlugin:resolve(required("--previous-plugin")),model:"gpt-6-luna",apiKey:phase==="run"?process.env.CM_AB_API_KEY??process.env.OPENAI_API_KEY??"":"",repetitions,maxCalls:12,maxSeconds:240};
if(phase==="run"&&!options.apiKey)throw Error("Missing in-memory credential");
console.log(JSON.stringify(await (phase==="prepare"?prepareSpeedAB(options):runSpeedAB(options))));
