import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join,resolve} from "node:path";
import {ROOT} from "./lib.js";
import {hash} from "../src/code-memory/source.js";
import {sumUsage} from "./harness_ab.js";
const directory=resolve(process.argv[2]!),read=(path:string)=>JSON.parse(readFileSync(path,"utf8"));
const data=read(join(directory,"results.json")),runs=data.results as Record<string,any>[],protocol=data.protocol,progress=read(join(directory,"progress.json"));
if(progress.state!=="complete"||runs.length!==36||runs.some(r=>!r.accounting_complete||!r.mode_verified))throw Error("Incomplete measured series");
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b),m=sorted.length>>1;return sorted.length%2?sorted[m]!:(sorted[m-1]!+sorted[m]!)/2;};
function groups(rows:typeof runs){return ["none","cm_previous","cm_fast"].map(arm=>{
  const items=rows.filter(r=>r.arm===arm);return {arm,runs:items.length,correct:items.filter(r=>r.task_success).length,tokens:items.reduce((s,r)=>s+r.usage.total_tokens,0),model_calls:items.reduce((s,r)=>s+r.model_calls,0),usd:items.reduce((s,r)=>s+r.usage.usd_estimate,0),seconds:items.reduce((s,r)=>s+r.duration_ms/1000,0),end_to_end_seconds:items.reduce((s,r)=>s+r.end_to_end_ms/1000,0),median_seconds:median(items.map(r=>r.duration_ms/1000))};
});}
const all=groups(runs),comparison=(a:string,b:string,rows=all)=>{const x=rows.find(r=>r.arm===a)!,y=rows.find(r=>r.arm===b)!;return {candidate:a,reference:b,tokens_percent:(x.tokens/y.tokens-1)*100,price_percent:(x.usd/y.usd-1)*100,time_percent:(x.seconds/y.seconds-1)*100,end_to_end_percent:(x.end_to_end_seconds/y.end_to_end_seconds-1)*100,median_time_percent:(x.median_seconds/y.median_seconds-1)*100};};
const pairs=runs.filter(r=>r.arm==="cm_fast").map(candidate=>{
 const control=runs.find(r=>r.arm==="none"&&r.task===candidate.task&&r.repetition===candidate.repetition)!;
 return {task:candidate.task,repetition:candidate.repetition,tokens_percent:(candidate.usage.total_tokens/control.usage.total_tokens-1)*100,time_percent:(candidate.duration_ms/control.duration_ms-1)*100,price_percent:(candidate.usage.usd_estimate/control.usage.usd_estimate-1)*100,control_success:control.task_success,candidate_success:candidate.task_success};
});
const first=runs[0]!,warm=groups(runs.filter(r=>r.task!==first.task||r.repetition!==first.repetition));
for(const run of runs){const meter=read(join(directory,"runs",run.run_id,"meter.json"));if(JSON.stringify(sumUsage(meter.calls))!==JSON.stringify(run.usage))throw Error("Usage reconciliation failed");}
const prepared=read(join(directory,"preparation.json")),manifest=read(join(directory,"corpus-manifest.json")),source=read(join(directory,"source-proof.json"));
const publicRoot=join(ROOT,"evaluation/speed-tokens");mkdirSync(publicRoot,{recursive:true});
const cleanProtocol={...protocol,previous_implementation:protocol.previous_implementation.map((entry:any)=>({...entry,path:entry.path.replace(/.*cm-speed-baseline-061[\\/]/,"baseline-0.6.1/").replaceAll("\\","/")}))};
const result={format:"cm-speed-tokens-result-1",model:protocol.model,summary:{groups:all,comparisons:[comparison("cm_fast","none"),comparison("cm_fast","cm_previous")],paired_wins:{time:pairs.filter(p=>p.time_percent<0).length,tokens:pairs.filter(p=>p.tokens_percent<0).length,price:pairs.filter(p=>p.price_percent<0).length,total:pairs.length},sensitivity:{method:"Exclude the entire first matched triple from secondary summary; all 36 remain in primary metrics",groups:warm,comparison:comparison("cm_fast","none",warm)},accounting_complete:true,model_calls:runs.reduce((s,r)=>s+r.model_calls,0)},pairs,runs,
  preprocessing:{corpus_index_ms:manifest.index_ms,source_bytes:manifest.source_bytes,derived_bytes:manifest.derived_bytes,files:manifest.files.length,includes_vendor:true,cases:prepared},source_proof:source,
  protocol_sha256:hash(readFileSync(join(directory,"frozen-protocol.json"))),price_is_estimate:true,limitations:protocol.limitations};
writeFileSync(join(publicRoot,"results.json"),JSON.stringify(result,null,2)+"\n");writeFileSync(join(publicRoot,"protocol.json"),JSON.stringify(cleanProtocol,null,2)+"\n");writeFileSync(join(publicRoot,"cases.json"),readFileSync(join(ROOT,".artifacts/speed-cases-v1.json")));
console.log(JSON.stringify(result.summary,null,2));
