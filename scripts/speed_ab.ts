import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { bootProfile, createCorpus, sumUsage } from "./harness_ab.js";
import type { ABOptions, ABCase, ProviderUsage } from "./harness_ab.js";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildVectors, EMBEDDING, LocalVectors } from "../src/code-memory/vector.js";
import { retrieveContext, renderContext } from "../src/code-memory/retrieve.js";
import { hash, inside } from "../src/code-memory/source.js";
import { ROOT } from "./lib.js";
import { directFileContext } from "../src/code-memory/direct.js";

type Task = ABCase & { category: string; changed_paths?: string[] };
type Options = ABOptions & { cases: string; reuseCache: string; previousPlugin: string };
const ARMS = ["none", "cm_previous", "cm_fast"] as const;
const PROMPT_SUFFIX = " Apply the change only in this isolated workspace. Preserve unrelated behavior and interfaces. Use supplied source when sufficient; otherwise inspect code. The same project_checks smoke is available to all variants; separate independent final checks evaluate your patch. Finish with a brief summary.";
const read = (path: string) => JSON.parse(readFileSync(path,"utf8"));
const write = (path: string, value: unknown) => writeFileSync(path,JSON.stringify(value,null,2));
const sources = (directory: string): string[] => readdirSync(join(ROOT,directory),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sources(directory+"/"+entry.name):entry.name.endsWith(".ts")?[directory+"/"+entry.name]:[]);
const trackedImplementation = () => [...sources("src"),"scripts/harness_ab.ts","scripts/harness_meter.ts","scripts/speed_ab.ts","scripts/speed_checks.ts","scripts/run_speed_ab.ts","scripts/project_checks_plugin.ts","scripts/lib.ts"].sort().flatMap(path=>[path,"dist/"+path.replace(/\.ts$/,".js")]).concat(["contracts/cm-local.schema.json","package-lock.json"]).map(path=>({path,sha256:hash(readFileSync(join(ROOT,path)))}));
const baselineFiles = (path: string): {path:string;sha256:string}[] => readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?baselineFiles(join(path,entry.name)):[{path:join(path,entry.name),sha256:hash(readFileSync(join(path,entry.name)))}]);
function grade(options: Options, workspace: string, baseline: string, task: string) {
  const env=Object.fromEntries(["PATH","Path","SystemRoot","WINDIR","TEMP","TMP"].flatMap(key=>process.env[key]?[[key,process.env[key]!]]:[]));
  try{return JSON.parse(execFileSync(options.node,[join(ROOT,"dist/scripts/speed_checks.js"),workspace,baseline,task],{env,encoding:"utf8",timeout:30000,windowsHide:true}));}
  catch(error){const failure=error as {stdout?:string};return failure.stdout?JSON.parse(failure.stdout):{pass:false,error:"Independent grader could not run"};}
}
export async function prepareSpeedAB(options: Options) {
  const output=resolve(options.output);if(existsSync(output))throw Error("Select a fresh experiment directory");
  const tasks=read(options.cases) as Task[];
  if(!tasks.length||tasks.some(t=>!/^[a-z0-9-]+$/.test(t.id))||new Set(tasks.map(t=>t.id)).size!==tasks.length)throw Error("Invalid tasks");
  const manifest=createCorpus(options), cache=read(options.reuseCache),embeddingCache=join(output,"embedding-cache.json");
  if(JSON.stringify(cache.embedding)!==JSON.stringify(EMBEDDING))throw Error("Wrong embedding cache");write(embeddingCache,cache);
  const prepared=[];
  for(const task of tasks){
    const baseline=grade(options,manifest.corpus,manifest.corpus,task.id);if(!baseline.behavior_pass)throw Error("Original behavior fails: "+task.id+JSON.stringify(baseline));
    const workspace=join(output,"cases",task.id);cpSync(manifest.corpus,workspace,{recursive:true,filter:path=>!path.includes(".code-memory")});
    for(const mutation of task.mutations){const path=resolve(workspace,mutation.path);if(!inside(workspace,path))throw Error("Unsafe mutation");const source=readFileSync(path,"utf8");if(source.split(mutation.before).length!==2)throw Error("Mutation must match once");writeFileSync(path,source.replace(mutation.before,mutation.after));}
    const seeded=grade(options,workspace,manifest.corpus,task.id);if(seeded.pass)throw Error("Unchanged task unexpectedly passes: "+task.id);
    const started=performance.now(),index=buildIndex(workspace,manifest.files.map(f=>f.path));mkdirSync(join(workspace,".code-memory"));write(join(workspace,".code-memory/index.json"),index);
    const config={directory:join(output,"projections",task.id),modelCache:options.modelCache!,embeddingCache,chunking:"unit" as const}, vectors=await buildVectors(index,config);
    // This preflight must not cache task query embeddings: the paid sessions have cold model processes.
    const retriever=new LocalVectors(config);let expected;
    try{const ctx=await directFileContext(workspace,task.prompt+PROMPT_SUFFIX,6000)??await retrieveContext(index,retriever,task.prompt+PROMPT_SUFFIX,6000,undefined,{policy:"adaptive"});expected={sha256:hash(renderContext(ctx)),source_bytes:ctx.bytes_used,retrieval:ctx.retrieval,channels:ctx.channels};}finally{retriever.close();}
    prepared.push({task:task.id,category:task.category,baseline,seeded,preparation_ms:performance.now()-started,vectors,expected});write(join(output,"preparation.json"),prepared);
    console.log(JSON.stringify({phase:"prepared",task:task.id,bytes:expected.source_bytes,route:expected.retrieval?.route}));
  }
  const protocol={format:"cm-speed-tokens-1",created_at:new Date().toISOString(),model:options.model,reasoning_effort:"low",arms:ARMS,repetitions:options.repetitions??2,
    cases_hash:hash(JSON.stringify(tasks)),corpus_hash:manifest.manifest_hash,source_revision:manifest.revision,implementation:trackedImplementation(),previous_implementation:baselineFiles(resolve(dirname(options.previousPlugin),"../../..")),
    runtime:{node_sha256:hash(readFileSync(options.node)),harness_entry_sha256:hash(readFileSync(options.harness))},preparation_sha256:hash(readFileSync(join(output,"preparation.json"))),
    max_model_calls:options.maxCalls??12,max_run_seconds:options.maxSeconds??240,max_estimated_usd:1,context_source_bytes:6000,prompt_suffix:PROMPT_SUFFIX,
    arms_config:{none:"No CM",cm_previous:"Frozen 0.6.1 graph/exact, autoUpdate + one-second background watcher",cm_fast:"Candidate adaptive: current small explicit file <=6KB; otherwise named graph/dense discovery; lean pinned MiniLM CPU; autoUpdate on demand, no background watcher"},
    order:"Counterbalanced rotate/reverse across cases and repeats; equal-length opaque workspace and run identities",
    quality:"Behavioral independent final fuzz with different public seed, export and protected-source/addition audit; optimization requires 1.25x actual full function CPU speedup",
    timing:"Harness spawn-to-close includes plugin import, cold embedding if used, source fences, tools, public checks and background work. Copy and independent final verification measured separately; cold index construction/rebuilds reported separately and amortized explicitly.",
    criterion:"CM-fast full session elapsed and total provider tokens lower than none; latency lower than previous; no fewer independent successes than either arm. Previous compact graph token change is reported. No statistical/general-purpose guarantee.",
    price:{input:.10,cache_read:.01,cache_write:.125,output:.50,per:1000000,source:"https://developers.openai.com/api/docs/models/gpt-6-luna"},
    limitations:["One repository/device, six new task specifications and two stochastic repeats","Ready per-task indexes are prepared offline, including a vendor module; first index and subsequent changed-source rebuild latency is separate, not free","Corpus consists of tracked game/**/*.js, not all project languages/assets","CPU optimization is one pure metrics routine, not full-game FPS","Old repair-only results are not added to this sample"]};
  write(join(output,"frozen-protocol.json"),protocol);return {planned:tasks.length*ARMS.length*protocol.repetitions,tasks:tasks.length};
}
export async function runSpeedAB(options: Options){
  const output=resolve(options.output),protocol=read(join(output,"frozen-protocol.json")),manifest=read(join(output,"corpus-manifest.json")),prepared=read(join(output,"preparation.json")),tasks=read(options.cases) as Task[];
  if(existsSync(join(output,"results.json"))||existsSync(join(output,"progress.json")))throw Error("Preserve experiment identities");
  if(hash(JSON.stringify(tasks))!==protocol.cases_hash||JSON.stringify(trackedImplementation())!==JSON.stringify(protocol.implementation)||JSON.stringify(baselineFiles(resolve(dirname(options.previousPlugin),"../../..")))!==JSON.stringify(protocol.previous_implementation)||options.model!==protocol.model||(options.repetitions??2)!==protocol.repetitions||hash(readFileSync(join(output,"preparation.json")))!==protocol.preparation_sha256||hash(readFileSync(options.node))!==protocol.runtime.node_sha256||hash(readFileSync(options.harness))!==protocol.runtime.harness_entry_sha256)throw Error("Frozen inputs changed");
  const results:Record<string,any>[]=[];let cost=0;
  for(let rep=1;rep<=protocol.repetitions;rep++)for(const [position,task] of tasks.entries()){
    const offset=(position+rep)%3,order=[...ARMS.slice(offset),...ARMS.slice(0,offset)];if((position+rep)%2)order.reverse();
    for(const arm of order){
      if(cost>=protocol.max_estimated_usd)throw Error("Experiment cost budget reached");
      const runId="run-"+hash(`${output}:${task.id}:${rep}:${arm}`).slice(0,16),source=join(output,"cases",task.id),workspace=join(output,"workspaces",runId),allStarted=performance.now();
      if(existsSync(workspace))throw Error("Workspace exists");cpSync(source,workspace,{recursive:true,filter:path=>!path.includes(".code-memory")});const copyMs=performance.now()-allStarted;
      write(join(output,"progress.json"),{state:"running",current:{runId,task:task.id,rep,arm},completed:results.length,planned:tasks.length*3*protocol.repetitions});
      const response=await bootProfile({...options,cmMode:"compact",contextBytes:6000,...(arm!=="none"?{autoUpdate:true,searchMode:"exact" as const,backgroundUpdate:arm==="cm_previous",...(arm==="cm_previous"?{retrievalPolicy:"graph" as const,cmPluginPath:options.previousPlugin}:{}),embeddingCache:join(output,"embedding-cache.json"),cmIndexPath:join(source,".code-memory/index.json"),cmVectorsPath:join(output,"projections",task.id)}:{}),projectCheck:{plugin:join(ROOT,"dist/scripts/project_checks_plugin.js"),script:join(ROOT,"dist/scripts/speed_checks.js"),task:task.id,baseline:manifest.corpus}},workspace,runId,task.prompt+protocol.prompt_suffix,arm!=="none");
      const meterPath=join(response.directory,"meter.json"),meter=existsSync(meterPath)?read(meterPath):{attempts:0,calls:[]},calls=meter.calls as any[],usage=sumUsage(calls as {usage:ProviderUsage|null}[]),gradeStarted=performance.now(),quality=grade(options,workspace,manifest.corpus,task.id),gradeMs=performance.now()-gradeStarted;
      const allowed=new Set(task.changed_paths??task.mutations.map(m=>m.path)),originalPaths=[...manifest.files.map((f:any)=>f.path),"package.json","AGENTS.md"];
      const scopeChanges=originalPaths.filter((path:string)=>!allowed.has(path)&&(!existsSync(join(workspace,path))||hash(readFileSync(join(source,path)))!==hash(readFileSync(join(workspace,path)))));
      const walk=(directory:string,prefix=""):string[]=>readdirSync(directory,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(directory,e.name),prefix+e.name+"/"):[prefix+e.name]);
      const addedFiles=walk(workspace).filter(path=>!originalPaths.includes(path)),stderr=readFileSync(join(response.directory,"stderr.txt"),"utf8");
      const accounted=calls.length>0&&calls.every((c,i)=>c.call===i+1&&c.usage&&c.finish)&&(meter.attempts===calls.length||stderr.includes("AB model-call limit reached")&&meter.attempts===calls.length+1&&calls.length===protocol.max_model_calls);
      const active=Boolean(calls[0]?.cm_context_present&&calls[0]?.cm_tools.includes("cm_retrieve_context")),retrievalPath=join(response.directory,"retrieval.json"),retrieval=existsSync(retrievalPath)?read(retrievalPath):[],initial=retrieval.find((e:any)=>e.event==="retrieved")??null;
      const mode=arm==="none"?!active&&!retrieval.length:active&&initial?.retrieval?.policy===(arm==="cm_previous"?"graph":"adaptive")&&(arm!=="cm_fast"||initial?.context_sha256===prepared.find((p:any)=>p.task===task.id).expected.sha256);
      const tools=(response.events as {type?:string;tool?:string}[]).filter(e=>e.type==="tool_call").map(e=>e.tool??"unknown");
      const record={run_id:runId,task:task.id,category:task.category,repetition:rep,arm,duration_ms:response.duration_ms,copy_ms:copyMs,independent_check_ms:gradeMs,end_to_end_ms:performance.now()-allStarted,exit_code:response.exit_code,
        task_success:Boolean(quality.pass&&!scopeChanges.length&&!addedFiles.length),quality,scope_changes:scopeChanges,added_files:addedFiles,model_calls:calls.length,attempts:meter.attempts,usage,accounting_complete:Boolean(accounted),mode_verified:Boolean(mode),cm_active:active,
        provider_ms:calls.reduce((s,c)=>s+c.duration_ms,0),tool_calls:Object.fromEntries([...new Set(tools)].map(t=>[t,tools.filter(v=>v===t).length])),initial_retrieval:initial};
      results.push(record);cost+=usage.usd_estimate;write(join(output,"results.json"),{protocol,estimated_cost_usd:cost,results});
      console.log(JSON.stringify({completed:results.length,task:task.id,rep,arm,quality:record.task_success,calls:record.model_calls,tokens:usage.total_tokens,seconds:response.duration_ms/1000,mode}));
      if(/INVALID_CREDENTIAL|MISSING_CREDENTIAL|insufficient_quota|AUTH:/.test(stderr)||!accounted||!mode)throw Error("Provider/accounting/activation failure; retained");
    }
  }
  const changes=manifest.files.filter((f:any)=>!existsSync(join(manifest.project,f.path))||hash(readFileSync(join(manifest.project,f.path)))!==f.sha256).map((f:any)=>f.path),unchanged=JSON.stringify(trackedImplementation())===JSON.stringify(protocol.implementation);
  write(join(output,"source-proof.json"),{original_files_checked:manifest.files.length,original_source_changes:changes,measured_implementation_unchanged:unchanged});
  if(changes.length||!unchanged)throw Error("Source or measured code changed during trial");
  write(join(output,"progress.json"),{state:"complete",completed:results.length,planned:results.length,cost});return {completed:results.length,cost};
}
