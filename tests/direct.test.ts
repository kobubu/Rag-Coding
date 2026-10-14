import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {directFileContext} from "../src/code-memory/direct.js";
import {hash} from "../src/code-memory/source.js";
test("direct CM reads fresh saved Unicode/CRLF bytes without an index, rejects ambiguity and honors budgets/scope", async()=>{
  const root=mkdtempSync(join(tmpdir(),"cm-direct-"));mkdirSync(join(root,"src"));const path=join(root,"src/one.ts"),source='\ufeffexport const message="Ж😀";\r\n';writeFileSync(path,source);
  const first=await directFileContext(root,"Change src/one.ts",6000);assert.equal(first?.parts[0]?.text,source);assert.equal(first?.parts[0]?.span.end_byte,Buffer.byteLength(source));assert.equal(first?.snapshot_id,"file:"+hash(Buffer.from(source)));
  writeFileSync(path,source.replace("Ж","Ш"));const second=await directFileContext(root,"Change src/one.ts",6000);assert.notEqual(first?.snapshot_id,second?.snapshot_id);assert(second?.parts[0]?.text.includes("Ш"));
  writeFileSync(join(root,".ts"),"export const misleading=1;");writeFileSync(join(root,"src/камера.ts"),source);
  assert.equal((await directFileContext(root,"Change src/камера.ts",6000))?.parts[0]?.path,"src/камера.ts");
  assert.equal(await directFileContext(root,"Change src/one.ts and two.ts",6000),undefined);assert.equal(await directFileContext(root,"src/one.ts",4),undefined);assert.equal(await directFileContext(root,"src/one.ts",6000,undefined,"game"),undefined);
  writeFileSync(path,'import {helper} from "./other.js"; export const call=()=>helper();');assert.equal(await directFileContext(root,"src/one.ts",6000),undefined);
  writeFileSync(path,'export async function load(){return import("./other.js");}');assert.equal(await directFileContext(root,"src/one.ts",6000),undefined);
  writeFileSync(path,"x".repeat(6001));assert.equal(await directFileContext(root,"src/one.ts",32000),undefined);
  const cancel=new AbortController();cancel.abort();await assert.rejects(directFileContext(root,"src/one.ts",6000,cancel.signal));
  await assert.rejects(directFileContext(root,"",6000),/invalid_argument/);
});
test("direct CM does not disclose a source path through a directory symlink outside its project",async()=>{
  const root=mkdtempSync(join(tmpdir(),"cm-direct-root-")),outside=mkdtempSync(join(tmpdir(),"cm-direct-external-"));writeFileSync(join(outside,"private.ts"),"export const value=1;");
  symlinkSync(outside,join(root,"linked"),process.platform==="win32"?"junction":"dir");assert.equal(await directFileContext(root,"linked/private.ts",6000),undefined);
  assert.equal(await directFileContext(root,"../private.ts",6000),undefined);
  mkdirSync(join(root,"src"));mkdirSync(join(root,"other"));writeFileSync(join(root,"other/private.ts"),"export const value=1;");
  symlinkSync(join(root,"other"),join(root,"src/alias"),process.platform==="win32"?"junction":"dir");assert.equal(await directFileContext(root,"src/alias/private.ts",6000,undefined,"src"),undefined);
});
