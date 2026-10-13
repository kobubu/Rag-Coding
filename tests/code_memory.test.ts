import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildIndex } from "../src/code-memory/indexer.js";
import { codeSearch, contextGet, graphExpand, symbolSearch } from "../src/code-memory/query.js";
import { CMStore, validateIndex } from "../src/code-memory/store.js";
import { ROOT } from "../scripts/lib.js";
import { mountHarnessPlugin } from "../scripts/harness_runtime.js";

const fixture = readFileSync(join(ROOT, "fixtures/batching.ts"), "utf8");
const project = mkdtempSync(join(tmpdir(), "cm-code-memory-"));
writeFileSync(join(project, "batching.ts"), fixture);
const index = validateIndex(buildIndex(project));
const nested = index.units.find((unit) => unit.name === "flush" && unit.kind === "function")!;

test("CM indexes lexical captures with exact source evidence and stable snapshots", () => {
  assert.deepEqual(nested.required_symbol_ids.map((id) => index.symbols.find((symbol) => symbol.id === id)!.name).sort(),
    ["batchNumber", "batches", "pending"].sort());
  assert.equal(index.snapshot_id, buildIndex(project).snapshot_id);
  const edges = index.relations.filter((edge) => edge.from_id === nested.id && edge.predicate === "captures");
  assert.equal(edges.length, 3);
  for (const edge of edges) assert(edge.evidence.start_byte >= nested.span.start_byte && edge.evidence.end_byte <= nested.span.end_byte);
});

test("code, glossary and context return original bytes and deduplicate the parent", () => {
  assert.equal(symbolSearch(index, "collectBatches").matches[0]?.name, "collectBatches");
  assert.equal(codeSearch(index, "batches.push").matches[0]?.name, "flush");
  const result = contextGet(index, nested.id);
  assert.equal(result.omissions.length, 0);
  assert.equal(result.items.length, 1);
  assert(result.items[0]?.text.includes("function collectBatches"));
  assert.equal(result.bytes_used, Buffer.byteLength(result.items[0]!.text, "utf8"));
  const constrained = contextGet(index, nested.id, 8);
  assert.equal(constrained.items.length, 0);
  assert(constrained.omissions.length > 0);
  assert.equal(constrained.completeness, "partial");
});

test("graph traversal is bounded and invalid arguments fail", () => {
  const result = graphExpand(index, nested.id, 1, 1, "captures");
  assert.equal(result.nodes.length, 1);
  assert.equal(result.truncated, true);
  assert.throws(() => graphExpand(index, nested.id, 4), /invalid_argument/);
  assert.throws(() => graphExpand(index, nested.id, 1, 30, "guess"), /invalid_argument/);
  assert.throws(() => symbolSearch(index, " "), /invalid_argument/);
  assert.throws(() => codeSearch(index, "flush", 0), /invalid_argument/);
});

test("BOM, CRLF and astral Unicode survive the local CM JSON roundtrip", () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-unicode-"));
  const source = "\ufeff" + fixture.replaceAll("\n", "\r\n");
  writeFileSync(join(directory, "batching.ts"), source);
  const memory = validateIndex(JSON.parse(JSON.stringify(buildIndex(directory))));
  assert.equal(memory.files[0]?.source, source);
  const symbol = symbolSearch(memory, "pending").matches[0]!;
  assert.equal(Buffer.from(source).subarray(symbol.span.start_byte, symbol.span.end_byte).toString("utf8"), "pending");
});

test("cross-file calls resolve compiler symbols and shadowed locals keep distinct identities", () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-bindings-"));
  writeFileSync(join(directory, "a.ts"), "export function helper() { return 7; }\n");
  writeFileSync(join(directory, "b.ts"), 'import { helper } from "./a.js";\nexport function use() { return helper(); }\n');
  writeFileSync(join(directory, "shadow.ts"), "export function outer() { let value = 1; function inner() { let value = 2; return value; } return inner(); }\n");
  const memory = validateIndex(buildIndex(directory));
  const helper = memory.symbols.find((symbol) => symbol.name === "helper" && symbol.path === "a.ts")!;
  const caller = memory.units.find((unit) => unit.name === "use")!;
  assert(memory.relations.some((edge) => edge.from_id === caller.id && edge.to_id === helper.id && edge.predicate === "calls"));
  const inner = memory.units.find((unit) => unit.name === "inner")!;
  const values = memory.symbols.filter((symbol) => symbol.name === "value");
  assert.equal(values.length, 2);
  assert.notEqual(values[0]?.id, values[1]?.id);
  assert(!inner.required_symbol_ids.some((id) => values.some((symbol) => symbol.id === id)));
});

test("malformed source is reported and inspected code is never executed", () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-diagnostics-"));
  writeFileSync(join(directory, "throws.ts"), fixture + '\nthrow new Error("must never execute");\n');
  writeFileSync(join(directory, "broken.ts"), "export function broken( {");
  const memory = validateIndex(buildIndex(directory));
  assert(memory.diagnostics.some((item) => item.path === "broken.ts"));
  assert(memory.units.some((unit) => unit.name === "collectBatches"));
  writeFileSync(join(directory, "bad.ts"), Buffer.from([0xff]));
  assert.throws(() => buildIndex(directory), /unsupported_encoding/);
});

test("JavaScript ES modules and CommonJS preserve bindings, context and source bytes", () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-javascript-"));
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "helper.js"), "export function normalize(value) { return Math.max(0, Number(value) || 0); }\n");
  writeFileSync(join(directory, "wallet.mjs"), 'import { normalize } from "./helper.js";\nexport function wallet(value) { const coins = normalize(value); return () => coins; }\n');
  writeFileSync(join(directory, "legacy.cjs"), 'function legacy(value) { return value + 1; }\nmodule.exports = legacy;\n');
  const memory = validateIndex(buildIndex(directory));
  assert.equal(memory.files.length, 3);
  assert(memory.capabilities.includes("javascript_syntax"));
  const normalize = memory.symbols.find((symbol) => symbol.path === "helper.js" && symbol.name === "normalize")!;
  assert(memory.relations.some((edge) => edge.to_id === normalize.id && edge.predicate === "calls"));
  assert(symbolSearch(memory, "legacy").matches.some((symbol) => symbol.path === "legacy.cjs"));
  const wallet = codeSearch(memory, "wallet").matches.find((unit) => unit.path === "wallet.mjs")!;
  const context = contextGet(memory, wallet.id);
  assert(context.items.some((item) => item.path === "helper.js" && item.text.includes("function normalize")));
  assert.equal(memory.files.find((file) => file.path === "wallet.mjs")!.source,
    readFileSync(join(directory, "wallet.mjs"), "utf8"));
});

test("CM validation rejects corrupted hashes, dangling edges and path traversal", () => {
  const damaged = structuredClone(index);
  damaged.files[0]!.source += " ";
  assert.throws(() => validateIndex(damaged), /Invalid source path or blob hash/);
  const dangling = structuredClone(index);
  dangling.relations[0]!.to_id = "missing";
  assert.throws(() => validateIndex(dangling), /Dangling graph edge/);
  const path = structuredClone(index);
  path.units[0]!.path = "../outside.ts";
  assert.throws(() => validateIndex(path), /Span belongs to another blob/);
  const outside = mkdtempSync(join(tmpdir(), "cm-outside-"));
  writeFileSync(join(outside, "outside.ts"), "export const outside = 1;");
  assert.throws(() => buildIndex(project, [join(outside, "outside.ts")]), /source_outside_project/);
});

test("cached indexes remain immutable and UTF-8 boundaries reject partial characters", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-cache-"));
  writeFileSync(join(directory, "source.js"), '\ufeffexport const label = "Ж😀";\n');
  const memory = validateIndex(buildIndex(directory));
  const corrupt = structuredClone(memory);
  corrupt.units.find((unit) => unit.kind === "file")!.span.start_byte = 1;
  assert.throws(() => validateIndex(corrupt), /UTF-8 character/);
  const path = join(directory, "index.json");
  writeFileSync(path, JSON.stringify(memory));
  const store = new CMStore(directory, path);
  const first = await store.load(new AbortController().signal);
  const second = await store.load(new AbortController().signal);
  assert.equal(first, second);
  assert(Object.isFrozen(first.units[0]!.span));
  assert.throws(() => { first.units[0]!.span.start_byte = 1; }, TypeError);
  writeFileSync(path, JSON.stringify(corrupt));
  await assert.rejects(store.load(new AbortController().signal), /UTF-8 character/);
});

test("store rejects changed source and a replaced snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-stale-"));
  const source = join(directory, "batching.ts");
  const target = join(directory, "index.json");
  writeFileSync(source, fixture);
  const memory = buildIndex(directory);
  writeFileSync(target, JSON.stringify(memory));
  const store = new CMStore(directory, target);
  const signal = new AbortController().signal;
  assert.equal((await store.load(signal)).snapshot_id, memory.snapshot_id);
  writeFileSync(source, fixture + "\n");
  await assert.rejects(store.load(signal), /index_outdated/);
  writeFileSync(target, JSON.stringify(buildIndex(directory)));
  await assert.rejects(store.load(signal, memory.snapshot_id), /snapshot_mismatch/);
  await assert.rejects(new CMStore(directory, join(directory, "missing.json")).load(signal), /index_not_ready/);
});

test("changes to analysis configuration invalidate CM even when source bytes are unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cm-config-"));
  writeFileSync(join(directory, "batching.ts"), fixture);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  const memory = buildIndex(directory);
  const target = join(directory, "index.json");
  writeFileSync(target, JSON.stringify(memory));
  const store = new CMStore(directory, target);
  const signal = new AbortController().signal;
  await store.load(signal);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "commonjs" }));
  await assert.rejects(store.load(signal), /Analysis input changed/);
  assert.notEqual(buildIndex(directory).snapshot_id, memory.snapshot_id);
});

test("real Harness registry dispatches four tools, rejects bad arguments and cleans up on unload", async () => {
  const target = join(project, "index.json");
  writeFileSync(target, JSON.stringify(index));
  const runtime = await mountHarnessPlugin({ projectRoot: project, indexPath: target });
  try {
    assert.equal(runtime.ctx.tools.schemas().length, 4);
    const search = await runtime.call("cm_symbol_search", { query: "flush" });
    assert.equal(search.isError, false);
    assert(search.content.some((item) => item.type === "text" && item.text.includes("Code Memory")));
    for (const [name, args] of [
      ["cm_code_search", { query: "batches.push" }],
      ["cm_context_get", { id: nested.id, snapshot_id: index.snapshot_id }],
      ["cm_graph_expand", { id: nested.id, snapshot_id: index.snapshot_id, predicate: "captures" }],
    ] as const) assert.equal((await runtime.call(name, args)).isError, false);
    assert.equal((await runtime.call("cm_symbol_search", { query: 17 })).isError, true);
    assert.equal((await runtime.call("cm_context_get", { id: nested.id })).isError, true);
    assert.equal((await runtime.call("cm_context_get", { id: nested.id, snapshot_id: "old" })).isError, true);
    const controller = new AbortController(); controller.abort();
    assert.equal((await runtime.call("cm_symbol_search", { query: "flush" }, controller.signal)).isError, true);
    await runtime.pluginFiber.dispose();
    assert.equal(runtime.ctx.tools.schemas().length, 0);
  } finally { await runtime.close(); }
});
