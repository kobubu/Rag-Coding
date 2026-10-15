import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildIndex } from "../src/code-memory/indexer.js";
import { LocalVectors } from "../src/code-memory/vector.js";
import { retrieveContext, renderContext } from "../src/code-memory/retrieve.js";
import { focusQuery } from "../src/code-memory/focus.js";
import { rereadPointer } from "../src/harness/plugin.js";
import { knowledge } from "../src/code-memory/knowledge.js";

test("adaptive exact route resolves duplicate names by path and compiler-bound dependencies without embeddings", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "one.js"), "const LIMIT=3;\nfunction adjust(n){return Math.max(0,LIMIT-n);}\nexport function quota(n){return adjust(n);}\n");
  writeFileSync(join(root, "two.js"), "export function quota(n){return n*100;}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const result = await retrieveContext(index, vectors, "Change `quota` in `one.js`", 3000, undefined, { policy: "adaptive" });
  assert.equal(result.retrieval?.dense_search, false);assert.equal(result.retrieval?.route, "named");
  assert(result.parts.some(part => part.text.includes("LIMIT=3")));assert(result.parts.some(part => part.text.includes("function adjust")));
  assert(result.parts.every(part => part.path === "one.js"));assert.equal(knowledge(index), knowledge(index));
  assert(knowledge(index).outgoing.get(index.units.find(unit => unit.name === "quota" && unit.path === "one.js")!.id)?.size);
});

test("graph budgets disclose large omitted declarations and expanded retrieval preserves exact Unicode ranges", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "lookup.js"), 'const VALUES={name:"' + "Ж😀".repeat(600) + '"};\nexport function lookup(){return VALUES.name;}\n');
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const small = await retrieveContext(index, vectors, "`lookup`", 1000, undefined, { policy: "adaptive" });
  assert(small.omissions > 0 && small.retrieval!.bindings_omitted > 0);assert(small.notes!.length);assert(small.bytes_used <= 1000);
  const expanded = await retrieveContext(index, vectors, "`lookup`", 8000, undefined, { policy: "adaptive", detail: "expanded" });
  assert(expanded.parts.some(part => part.text.includes("Ж😀".repeat(600))));assert.equal(expanded.retrieval!.bindings_omitted, 0);
  for (const part of expanded.parts) assert.equal(part.text, Buffer.from(index.files.find(file => file.path === part.path)!.source).subarray(part.span.start_byte, part.span.end_byte).toString("utf8"));
  const controller = new AbortController();controller.abort();await assert.rejects(retrieveContext(index, vectors, "`lookup`", 1000, controller.signal, { policy: "adaptive" }));
});

test("retrieval ignores generic agent instructions and shows small files whole", async () => {
  assert.equal(focusQuery("Fix `quota` in rules.js. Apply the change only in this isolated workspace. Finish with a brief summary."), "Fix `quota` in rules.js.");
  assert.equal(focusQuery("Preserve unrelated behavior and interfaces."), "Preserve unrelated behavior and interfaces.");
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "rules.js"), "const LIMIT=3;\nexport const NAME='rules';\nexport function quota(n){return Math.max(0,LIMIT-n);}\n");
  writeFileSync(join(root, "large.js"), "export function other(){return 1;}\n" + "export const PAD='" + "x".repeat(4000) + "';\nexport function quota2(){return other();}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const small = await retrieveContext(index, vectors, "Change `quota` in `rules.js`", 3000, undefined, { policy: "adaptive" });
  assert.deepEqual(small.parts.map(part => [part.path, part.whole]), [["rules.js", true]]);assert(renderContext(small).includes("(whole file)"));
  assert(renderContext(small).includes("No resolved bindings"));
  const large = await retrieveContext(index, vectors, "Change `quota2` in `large.js`", 6000, undefined, { policy: "adaptive" });
  assert(large.parts.every(part => !part.whole));assert(!large.parts.some(part => part.text.includes("x".repeat(100))));
});

test("callers come from the compiler graph and an unchanged whole file is not re-sent on its first re-read", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "wallet.js"), "export function sync(w){return w+1;}\n");
  writeFileSync(join(root, "main.js"), "import {sync} from './wallet.js';\nexport function boot(){return sync(1);}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const context = await retrieveContext(index, vectors, "Fix `sync` in `wallet.js`", 3000, undefined, { policy: "adaptive" });
  assert(context.notes!.some(note => note === "Call sites of sync: boot (main.js:2)."));
  const part = context.parts.find(item => item.path === "wallet.js")!;assert.equal(part.whole, true);
  const delivered = new Map([[join(root, "wallet.js"), { path: "wallet.js", version: part.span.file_version_id, lines: part.span.line_end }]]);
  assert.equal(await rereadPointer(delivered, root, "grep", { file_path: "wallet.js" }), undefined);
  assert.match((await rereadPointer(delivered, root, "read", { file_path: "wallet.js", offset: 1 }))!.text, /unchanged since the CM context/);
  assert.equal(await rereadPointer(delivered, root, "read", { file_path: "wallet.js" }), undefined);
  const changed = new Map([[join(root, "wallet.js"), { path: "wallet.js", version: part.span.file_version_id, lines: 1 }]]);
  writeFileSync(join(root, "wallet.js"), "export function sync(w){return w+2;}\n");
  assert.equal(await rereadPointer(changed, root, "read", { file_path: "wallet.js" }), undefined);
});
