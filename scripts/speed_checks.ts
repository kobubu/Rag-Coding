import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { hash } from "../src/code-memory/source.js";
import { checkHoldoutTask, HOLDOUT } from "./holdout_checks.js";
import { SEMVER } from "./semver_checks.js";

export async function checkSpeedTask(workspace: string, baseline: string, task: string, smoke = false) {
  let checks = 0;
  const load = async (root: string, path: string) => import(pathToFileURL(join(root, path)).href + "?v=" + hash(readFileSync(join(root, path))));
  const same = (actual: unknown, expected: unknown, name: string) => { checks++;assert.deepEqual(actual, expected, name); };
  let seed = smoke ? 239 : 99173;
  const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const count = smoke ? 6 : 90;
  const targets: Record<string, string> = {
    "circle-contact": "game/src/core/geometry.js", "camera-time": "game/fil/src/cameraModel.js",
    "wallet-delta": "game/src/core/reward-wallet.js", "motion-envelope": "game/fil/src/geoCollisionCandidates.js",
    "quota-receipts": "game/src/core/progression.js", "statistics-linear": "game/src/metrics/statistics.js",
  };
  if (HOLDOUT[task] || SEMVER[task]) return checkHoldoutTask(load, workspace, baseline, task, smoke);
  const path = targets[task];if (!path) throw Error("Unknown speed task");
  const actual = await load(workspace, path), original = await load(baseline, path);
  same(Object.keys(actual).sort(), Object.keys(original).sort(), "Export surface");
  if (task === "circle-contact") {
    const tangent = [{x:5,y:-5,r:5}, {x:-5,y:5,r:5}, {x:15,y:5,r:5}, {x:5,y:15,r:5}];
    for (const circle of tangent) same(actual.circleRect(circle,{x:0,y:0,w:10,h:10}),false,"Strict tangency");
    for (let i=0;i<count;i++) {
      const rect={x:rnd()*20,y:rnd()*20,w:rnd()*20,h:rnd()*20},circle={x:rnd()*40,y:rnd()*40,r:rnd()*10};
      const dx=circle.x-Math.max(rect.x,Math.min(rect.x+rect.w,circle.x)),dy=circle.y-Math.max(rect.y,Math.min(rect.y+rect.h,circle.y));
      same(actual.circleRect(circle,rect),dx*dx+dy*dy<circle.r*circle.r,"Nearest point geometry");
      same(actual.touchesHazard({...circle,z:0},{...rect,z:2},0),false,"Depth gate");
      same(actual.poseAt({...rect,motion:{dx:4,dy:2,period:3,phase:1}},i/7),original.poseAt({...rect,motion:{dx:4,dy:2,period:3,phase:1}},i/7),"Unrelated motion");
    }
  } else if (task === "camera-time") {
    for (let i=0;i<count;i++) for (const dt of [-1,-.01,0,.016,.2]) {
      const input={currentY:rnd()*500-100,playerCenterY:rnd()*2000,playerHeight:34,viewHeight:400+rnd()*300,worldHeight:2000,mode:i%3?"cube":"plane",gravity:i%4?-1:1,yellowActive:i%5===0,sectionLane:i%2?600:1400,dt};
      const result=actual.stepVerticalCamera(input), expected=original.stepVerticalCamera(input);
      same(result,expected,"Negative dt and safety envelope");
      assert(result.screenRatio>=actual.CAMERA_VERTICAL_RULES.safeMinRatio-1e-10&&result.screenRatio<=actual.CAMERA_VERTICAL_RULES.safeMaxRatio+1e-10||result.y===result.bounds.min||result.y===result.bounds.max);checks++;
    }
  } else if (task === "wallet-delta") {
    for (let i=0;i<count;i++) {
      const receipts=Array.from({length:i%13},(_,n)=>n%3?`video10:${n}`:`other:${n}`),wallet={coins:i%2?i+.7:-4,videoRewards:i%8},save={rewardReceipts:receipts};
      const copied=structuredClone({wallet,save}), expected={coins:Math.max(0,Math.floor(Number(wallet.coins)||0))+Math.max(0,receipts.filter(r=>r.startsWith("video10:")).length-wallet.videoRewards)*10,videoRewards:receipts.filter(r=>r.startsWith("video10:")).length};
      const next=actual.syncVideoRewardWallet(wallet,save);same(next,expected,"Only unapplied receipts credited");
      same(actual.syncVideoRewardWallet(next,save),next,"Idempotent synchronization");same({wallet,save},copied,"Non-mutating wallet input");
    }
    same(actual.syncVideoRewardWallet({},{}),{coins:0,videoRewards:0},"Missing legacy fields");
  } else if (task === "motion-envelope") {
    for(let i=0;i<count;i++){
      const movers=Array.from({length:12},(_,n)=>({id:n,x:rnd()*500,w:10+rnd()*30,axis:n%2?"x":"y",amp:(rnd()-.5)*200}));
      const rotors=Array.from({length:6},(_,n)=>({id:n,x:rnd()*500,length:40+rnd()*140,thickness:12}));
      const level={platforms:[],hazards:[],movers,rotors}, next=actual.createGeoCollisionCandidates(level);
      for(let q=0;q<8;q++){
        const left=rnd()*500,right=left+40;
        const expected=movers.filter(m=>{const reach=m.axis==="x"?Math.abs(m.amp):0;return m.x-reach<right&&m.x+m.w+reach>left;});
        const found=next.movers(left,right);same(found,expected,"Full swept X envelope and source order");
        for(const item of found) { checks++;assert.equal(item,movers[item.id],"Original body identity"); }
        same(next.rotors(left,right),rotors.filter(r=>r.x-Math.hypot(r.length,r.thickness)/2<right&&r.x+Math.hypot(r.length,r.thickness)/2>left),"Unrelated rotor sweep");
      }
    }
  } else if (task === "quota-receipts") {
    const policy=await load(workspace,"game/src/core/reward-policy.js");
    const now=Date.UTC(2026,9,14,12),day="2026-10-14";
    for(let i=0;i<count;i++){
      const used=i%4,recorded=i%3,save=actual.freshProgress();save.rewardDay={day,count:recorded};
      save.grants=Object.fromEntries(Array.from({length:used},(_,n)=>[`${day}/ad/${n}`,20]));
      const quota=policy.dailyRewardStatus(save,now);same(quota.used,Math.max(used,recorded),"Both ledger and counter respected");
      const expected=used<3&&recorded<3,ok=actual.creditAdReward(save,"fresh-receipt",20,now);same(ok,expected,"Quota limits");
      const once=structuredClone(save);same(actual.creditAdReward(save,"fresh-receipt",20,now),false,"Duplicate receipt rejected");same(save,once,"Duplicate leaves save unchanged");
      save.rewardDay={day:"2026-10-15",count:3};same(actual.creditAdReward(save,"clock-rollback",20,now),false,"Clock rollback cannot reopen quota");
    }
    for(const receipt of [null,"","x".repeat(100)]) same(actual.creditAdReward(actual.freshProgress(),receipt,20,now),false,"Invalid receipt");
  } else {
    const sequences: unknown[][]=[[],["a"],["2","1","2","b","a"],["__proto__","x","__proto__"],[1,"1",2,"2",1,"1"],[null,false,null,true]];
    for(let i=0;i<count;i++) sequences.push(Array.from({length:i%45},()=>Math.floor(rnd()*9).toString()));
    for(const sequence of sequences){const prior=structuredClone(sequence);same(actual.sequenceStats(sequence),original.sequenceStats(sequence),"Full statistics/entropy/first tie");same(sequence,prior,"Non-mutating statistics");
      for(const name of ["entropy","maxRun","maxRunDetail"])same(actual[name](sequence),original[name](sequence),"Unrelated statistics helper: "+name);
      for(const size of [1,2,3])same(actual.repeatedNgramShare(sequence,size),original.repeatedNgramShare(sequence,size),"Unrelated n-gram share");
    }
    for(const ratio of [0,.25,.5,.75,1])same(actual.percentile([4,-9,3,33],ratio),original.percentile([4,-9,3,33],ratio),"Unrelated percentiles");
    if(resolve(workspace)===resolve(baseline)) return {pass:false,behavior_pass:true,checks,mode:"baseline-behavior-only",cpu:null,required_speedup:1.25};
    const sequence=Array.from({length:6000},(_,n)=>`distinct-${n}`), samples:{baseline_ms:number;candidate_ms:number}[]=[];
    const timed=(fn: (s: string[])=>any)=>{const started=performance.now();const result=fn(sequence);assert.equal(result.classCount,sequence.length);return performance.now()-started;};
    timed(original.sequenceStats);timed(actual.sequenceStats);
    for(let i=0;i<(smoke?3:7);i++){
      const order=i%2?[actual.sequenceStats,original.sequenceStats,original.sequenceStats,actual.sequenceStats]:[original.sequenceStats,actual.sequenceStats,actual.sequenceStats,original.sequenceStats];
      const times=order.map(fn=>({candidate:fn===actual.sequenceStats,ms:timed(fn)}));
      samples.push({baseline_ms:times.filter(t=>!t.candidate).reduce((s,t)=>s+t.ms,0)/2,candidate_ms:times.filter(t=>t.candidate).reduce((s,t)=>s+t.ms,0)/2});
    }
    const median=(ns:number[])=>ns.sort((a,b)=>a-b)[ns.length>>1]!;
    const baselineMs=median(samples.map(s=>s.baseline_ms)),candidateMs=median(samples.map(s=>s.candidate_ms));
    const improved=candidateMs<=baselineMs*.8;
    return {pass:improved,behavior_pass:true,checks,mode:smoke?"public-smoke":"independent-final",cpu:{baseline_ms:baselineMs,candidate_ms:candidateMs,speedup:baselineMs/candidateMs,samples},required_speedup:1.25};
  }
  return {pass:true,behavior_pass:true,checks,mode:smoke?"public-smoke":"independent-final"};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  try{console.log(JSON.stringify(await checkSpeedTask(resolve(process.argv[2]!),resolve(process.argv[3]!),process.argv[4]!,process.argv.includes("--public"))));}
  catch(error){console.log(JSON.stringify({pass:false,behavior_pass:false,error:String(error).slice(0,1400)}));process.exitCode=1;}
}
