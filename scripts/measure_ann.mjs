import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {connect} from '@lancedb/lancedb';
import {buildAnn,localEmbedder,LocalVectors} from '../dist/src/code-memory/vector.js';
import {retrieveContext,renderContext} from '../dist/src/code-memory/retrieve.js';
import {CMStore} from '../dist/src/code-memory/store.js';
import {agentOptions} from '../dist/src/local-agent/config.js';

const cli=process.argv.slice(2),offset=cli.indexOf('--output');
const destination=offset<0?'.artifacts/ann-benchmark-'+Date.now():cli[offset+1];
if(offset>=0)cli.splice(offset,2);
assert(destination,'--output needs a directory');
const options=agentOptions(cli),root=path.resolve(destination);
assert(!existsSync(root),'Preserve earlier output; select a new directory');
const signal=new AbortController().signal;
const index=await new CMStore(options.projectRoot,options.indexPath).load(signal);
await mkdir(root,{recursive:true});
await cp(options.vectorsPath,path.join(root,'vectors'),{recursive:true,errorOnExist:true,force:false});
const config={directory:path.join(root,'vectors'),modelCache:options.modelCache,chunking:options.chunking};
const built=await buildAnn(index,config);
const manifest=JSON.parse(await readFile(path.join(root,'vectors/manifest.json'),'utf8'));
const database=await connect(config.directory),table=await database.openTable(manifest.table);
const exact=new LocalVectors({...config,searchMode:'exact'}),ann=new LocalVectors({...config,searchMode:'ann'});
try {
 const indices=await table.listIndices();assert(indices.some(item=>item.indexType.toUpperCase().includes('HNSW')));
 const stored=await table.query().select(['id','vector']).toArray();
 const texts=['remaining daily allowance for rewarded video advertisements','merge overlapping rectangular areas into separate geometry cells','which collision candidates overlap the horizontal screen','camera tracks the player vertical position','persist user progress without losing purchased items','keyboard input jump pressed and released','calculate reward balance from payment receipts','avoid duplicate rewards on retry','world map projection and geographic coordinates','translate user interface language strings','resume gameplay after a pause','render surfaces with opaque platform cap geometry','deterministic fixed timestep interpolation','install native advertising bridge','load scene assets and audio music','record leaderboard best completed times'];
 const embed=localEmbedder(config.modelCache),natural=await embed(texts);
 const queries=natural.map((vector,i)=>({label:'natural-'+i,vector}));
 for(let i=0;i<32;i++){const row=stored[Math.floor(i*(stored.length-1)/31)];queries.push({label:'stored-'+i,vector:Array.from(row.vector)});}
 const search=(vector,approximate)=>{let request=table.vectorSearch(vector).distanceType('cosine').limit(24);request=approximate?request.nprobes(1).ef(128).refineFactor(4):request.bypassVectorIndex();return request.select(['id','_distance']).toArray();};
 const median=values=>[...values].sort((a,b)=>a-b)[values.length>>1],rows=[];
 for(const query of queries){
  const truth=await search(query.vector,false),candidate=await search(query.vector,true),ids=new Set(truth.map(row=>row.id)),cutoff=Number(truth.at(-1)._distance),paired=[];
  for(let block=0;block<5;block++){
   const samples=[];
   for(const approximate of block%2?[true,false,false,true]:[false,true,true,false]){const start=performance.now();await search(query.vector,approximate);samples.push({ann:approximate,ms:performance.now()-start});}
   paired.push({exact_ms:samples.filter(row=>!row.ann).reduce((n,row)=>n+row.ms,0)/2,ann_ms:samples.filter(row=>row.ann).reduce((n,row)=>n+row.ms,0)/2});
  }
  rows.push({query:query.label,strict_recall_at_24:candidate.filter(row=>ids.has(row.id)).length/24,tie_aware_recall_at_24:candidate.filter(row=>Number(row._distance)<=cutoff+1e-6).length/24,exact_ms:median(paired.map(row=>row.exact_ms)),ann_ms:median(paired.map(row=>row.ann_ms)),paired});
 }
 const contexts=[];
 for(const text of texts.slice(0,3)){
  const before=performance.now(),a=await retrieveContext(index,exact,text),middle=performance.now(),b=await retrieveContext(index,ann,text),end=performance.now();
  const digest=context=>createHash('sha256').update(renderContext(context)).digest('hex');
  contexts.push({query:text,exact_ms:middle-before,ann_ms:end-middle,render_equal:digest(a)===digest(b),exact_bytes:a.bytes_used,ann_bytes:b.bytes_used});
 }
 const mean=key=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
 const summary={format:'cm-hnsw-probe-1',snapshot_id:index.snapshot_id,rows:manifest.rows,index:built.ann,build_ms:built.milliseconds,queries:rows.length,natural_queries:texts.length,k:24,blocks:5,strict_recall_at_24:mean('strict_recall_at_24'),tie_aware_recall_at_24:mean('tie_aware_recall_at_24'),median_exact_ms:median(rows.map(row=>row.exact_ms)),median_ann_ms:median(rows.map(row=>row.ann_ms)),contexts,indices:indices.map(({indexType,columns})=>({indexType,columns})),limitations:['One local device, 16 natural queries plus 32 stored vectors; no provider/model solution-quality A/B','Native query timing excludes embedding/source hashing/context assembly; context measurements single pass and first includes cold caches','HNSW/SQ approximate; tie-aware recall compares exact distance boundary at k, strict recall compares IDs']};
 await writeFile(path.join(root,'proof.json'),JSON.stringify({summary,measurements:rows},null,2));
 console.log(JSON.stringify(summary));
} finally {exact.close();ann.close();table.close();database.close();}
