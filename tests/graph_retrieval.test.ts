import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildVectors, EMBEDDING, LocalVectors } from "../src/code-memory/vector.js";
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
  assert.equal(focusQuery("Fix `quota`. The public smoke check is the shell command /tmp/runs/run-9f8e7d6c/project_checks; finish."), "Fix `quota`.");
  assert.equal(focusQuery("Repair the parser in /home/me/app/src/parse.ts so it accepts tabs."), "Repair the parser in parse.ts so it accepts tabs.");
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

test("an English word that equals a minified function name does not anchor the named route", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "pace.js"), "export function simulationPace(level){const p=level.pace;return p>0?p:1;}\n");
  writeFileSync(join(root, "three.min.js"), "export function A(t,e){return t+e}export function Find(t){return t}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const context = await retrieveContext(index, vectors, "A level with zero pace must fall back in `simulationPace`. Find the helper.", 3000, undefined, { policy: "adaptive" });
  assert.deepEqual([...new Set(context.parts.map(part => part.path))], ["pace.js"]);
});

test("a short file with a match is shown whole before dependencies take the budget", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  const helpers = Array.from({ length: 5 }, (_, n) => `export function help${n}(v){return v+${n}; /* ${"x".repeat(1050)} */}\n`).join("");
  writeFileSync(join(root, "helpers.js"), helpers);
  writeFileSync(join(root, "ledger.js"), "import {help0,help1,help2,help3,help4} from './helpers.js';\n" +
    "export function claim(v){return help0(v)+help1(v)+help2(v)+help3(v)+help4(v);}\n" + "export function normalize(v){return v%2===0?v:0;" + " ".repeat(600) + "}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const context = await retrieveContext(index, vectors, "Fix `claim` in `ledger.js`", 6000, undefined, { policy: "adaptive" });
  assert(context.parts.some(part => part.path === "ledger.js" && part.whole), "matched short file shown whole");
  assert(context.bytes_used <= 6000);
});

test("a request across uses adds the matched module's users that the query points to", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "policy.js"), "export const DAILY_LIMIT = 3;\nexport function quotaStatus(save){return {limit: DAILY_LIMIT, used: save.used};}\n");
  writeFileSync(join(root, "progress.js"), "import {DAILY_LIMIT} from './policy.js';\nexport function readProgress(saved){return {count: Math.min(DAILY_LIMIT, saved.count)};}\n");
  writeFileSync(join(root, "other.js"), "export function unrelated(v){return v;}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const across = await retrieveContext(index, vectors, "Make `quotaStatus` take a per-save limit wherever the daily limit applies, also when reading progress counts.", 6000, undefined, { policy: "adaptive" });
  assert.deepEqual([...new Set(across.parts.map(part => part.path))].sort(), ["policy.js", "progress.js"]);
  const single = await retrieveContext(index, vectors, "Fix `quotaStatus` so the reported progress counts use the daily limit.", 6000, undefined, { policy: "adaptive" });
  assert.deepEqual([...new Set(single.parts.map(part => part.path))], ["policy.js"]);
});

test("a function in the found file named by a rare query word joins a root whose name says nothing about the request", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "range.js"), "const replaceCaret = (comp) => comp.replace(/\\^(\\d+)\\.(\\d+)/, (_, M, m) => '>=' + M + '.' + m + ' <' + (+M + 1));" + " ".repeat(3500) + "\n" +
    "function testSet(set, version, options) { if (version.prerelease.length && !options.includePrerelease) return set.some(c => c.semver.major === version.major && c.semver.minor === version.minor && c.semver.patch === version.patch && c.accept(version) && c.later(version) && c.zero(version) && c.ranges); return true }\n" +
    "module.exports = { replaceCaret, testSet };\n");
  writeFileSync(join(root, "other.js"), "export function check(version, options) { return version.prerelease && options.keep && version.major && version.minor; }\n" +
    "export function probe(version) { return version.patch === 0 && version.ranges; }\n");
  const embed = async (texts: string[]) => texts.map(() => { const vector = Array<number>(EMBEDDING.dimensions).fill(0);vector[0] = 1;return vector; });
  const index = buildIndex(root), config = { directory: join(root, "vectors"), modelCache: root };
  await buildVectors(index, config, embed);
  const vectors = new LocalVectors(config, embed);
  const context = await retrieveContext(index, vectors, "Caret ranges for a zero major version accept later minors and patch versions; keep prerelease options.", 6000, undefined, { policy: "adaptive" });
  assert(context.parts.some(part => part.text.includes("comp.replace(")), "replaceCaret shown");
});

test("a rename request lists every code occurrence of the name, imports included", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-graph-"));
  writeFileSync(join(root, "days.js"), "export function validDay(day){return /^\\d{4}$/.test(day);}\nexport function grants(keys){return keys.filter(validDay);}\n");
  writeFileSync(join(root, "progress.js"), "import {validDay} from './days.js';\nexport function read(saved){return validDay(saved.day) ? saved : null;}\n");
  const index = buildIndex(root), vectors = new LocalVectors({ directory: root, modelCache: root }, async () => { throw Error("Unexpected embedding call"); });
  const renamed = await retrieveContext(index, vectors, "Rename `validDay` to `isCalendarDay` everywhere.", 6000, undefined, { policy: "adaptive" });
  assert(renamed.notes!.includes("Every code occurrence of validDay in the indexed source (definition, imports, calls, references): days.js:1, days.js:2, progress.js:1, progress.js:2. This is the complete list for code, so a search for it is unnecessary; only comments and strings are not covered."), renamed.notes!.join("\n"));
  const fixed = await retrieveContext(index, vectors, "Fix `validDay` for leap days.", 6000, undefined, { policy: "adaptive" });
  assert(!fixed.notes!.some(note => note.startsWith("Every code occurrence")));
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
