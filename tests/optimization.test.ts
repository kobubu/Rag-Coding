import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkOptimization } from "../scripts/optimization_checks.js";

test("optimization evaluator rejects a fast wrong-order patch and never accepts unchanged code", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-quality-")), original = join(root, "original"), candidate = join(root, "candidate");
  const source = 'export function createHorizontalRenderIndex(items,bounds=x=>x){const entries=items.map(item=>{const r=bounds(item);return {item,left:r.x,right:r.x+(r.w||0)};});return (left,right)=>entries.filter(e=>e.right>left&&e.left<right).map(e=>e.item);}\n';
  for (const directory of [original, candidate]) {
    mkdirSync(join(directory, "game/fil/src"), { recursive: true });
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    writeFileSync(join(directory, "game/fil/src/renderVisibilityModel.js"), source);
    writeFileSync(join(directory, "game/fil/src/levels.js"), 'export const levels=[{number:1,platforms:[{x:0,y:0,w:10,h:20}],hazards:[],movers:[],rotors:[]}];');
  }
  const unchanged = await checkOptimization(candidate, original, "horizontal", true);
  assert.equal(unchanged.behavior.pass, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.optimization_pass, false);
  writeFileSync(join(candidate, "game/fil/src/renderVisibilityModel.js"), source.replace('.map(e=>e.item)', '.map(e=>e.item).reverse()'));
  const incorrect = await checkOptimization(candidate, original, "horizontal", true);
  assert.equal(incorrect.behavior.pass, false);
  assert.equal(incorrect.optimization_pass, false);
  assert.equal(incorrect.performance, undefined);
  assert(incorrect.behavior.failures.some(failure => failure.check.includes("range-fuzz") || failure.check.includes("order")));
});
