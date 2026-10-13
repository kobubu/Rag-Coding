import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "../src/code-memory/indexer.js";
import { chunkingPolicy, projectChunks } from "../src/code-memory/chunks.js";
import { buildVectors, EMBEDDING, LocalVectors, sourceSlice } from "../src/code-memory/vector.js";
import { retrieveContext } from "../src/code-memory/retrieve.js";

test("windows preserve exact UTF-8/CRLF source, cover files, and overlap without broken characters", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-chunks-"));
  const source = '\ufeffexport const label="Ж😀";\r\n' + Array.from({length:120}, (_, i) => `export const item${i}="Значение😀${i}";\r\n`).join("");
  writeFileSync(join(root, "windows.ts"), source);
  const index = buildIndex(root), chunks = projectChunks(index, "window");
  const raw = Buffer.from(source), covered = new Uint8Array(raw.length);
  assert(chunks.length > 2);
  for (const chunk of chunks) {
    const bytes = raw.subarray(chunk.span.start_byte, chunk.span.end_byte);
    assert(Buffer.from(bytes.toString("utf8")).equals(bytes));
    assert(bytes.length <= chunkingPolicy("window").target_bytes);
    covered.fill(1, chunk.span.start_byte, chunk.span.end_byte);
  }
  assert(covered.every(value => value === 1));
  assert(chunks.some((chunk, i) => i > 0 && chunk.span.start_byte < chunks[i - 1]!.span.end_byte));
  assert.deepEqual(chunks, projectChunks(index, "window"));
  assert.throws(() => chunkingPolicy("invalid" as "ast"), /Unknown/);
});

test("AST projection keeps signatures and resolves captured variables across chunk boundaries", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-ast-"));
  const source = 'export const LIMIT=5;\nexport function optimize(input:number){\n const local=input+LIMIT;\n' +
    Array.from({length:80}, (_, i) => ` if(input===${i}) return local+${i};\n`).join("") + ' return local;\n}\n';
  writeFileSync(join(root, "large.ts"), source);
  const index = buildIndex(root), chunks = projectChunks(index, "ast");
  assert(chunks.filter(chunk => chunk.symbol_names.includes("optimize")).length > 3);
  const captured = chunks.find(chunk => chunk.required_symbol_ids.some(id => index.symbols.find(symbol => symbol.id === id)?.name === "local"))!;
  assert(captured.signatures.length > 0);
  const embed = async (texts: string[]) => texts.map(() => [1, ...Array<number>(EMBEDDING.dimensions - 1).fill(0)]);
  const config = { directory: join(root, "vectors"), modelCache: root, chunking: "ast" as const };
  await buildVectors(index, config, embed);
  const vectors = new LocalVectors(config, embed);
  try {
    const context = await retrieveContext(index, vectors, '`optimize` input local', 3500);
    assert(context.bytes_used <= 3500);
    assert(context.parts.some(part => part.reason === "signature"));
    for (const [i, a] of context.parts.entries()) for (const b of context.parts.slice(i + 1)) assert(a.path !== b.path || a.span.end_byte <= b.span.start_byte || b.span.end_byte <= a.span.start_byte);
    const wrong = new LocalVectors({ ...config, chunking: "window" }, embed);
    try { await assert.rejects(wrong.search(index, "optimize"), /vectors_outdated/); } finally { wrong.close(); }
    const path = join(root, "vectors/manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")); manifest.records_hash = "tampered";
    writeFileSync(path, JSON.stringify(manifest));
    await assert.rejects(vectors.search(index, "optimize"), /vectors_outdated/);
  } finally { vectors.close(); }
});

test("a scope signature inside a matched window does not discard its source body", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-window-context-"));
  writeFileSync(join(root, "window.ts"), 'export function computeRange(input:number){\n const FIRST_BODY=input+1;\n //' + 'x'.repeat(750) + '\n const LAST_BODY=FIRST_BODY+2; return LAST_BODY;\n}\n');
  const index = buildIndex(root), config = { directory: join(root, "vectors"), modelCache: root, chunking: "window" as const };
  const embed = async (texts: string[]) => texts.map(() => [1, ...Array<number>(EMBEDDING.dimensions - 1).fill(0)]);
  await buildVectors(index, config, embed);
  const vectors = new LocalVectors(config, embed);
  try {
    const context = await retrieveContext(index, vectors, '`computeRange` FIRST_BODY LAST_BODY', 5000);
    assert(context.parts.some(part => part.reason === "signature"));
    assert(context.parts.map(part => part.text).join("").includes('const FIRST_BODY=input+1'));
    for (const [i, a] of context.parts.entries()) for (const b of context.parts.slice(i + 1)) assert(a.span.end_byte <= b.span.start_byte || b.span.end_byte <= a.span.start_byte);
  } finally { vectors.close(); }
});

test("shared source encoding never conceals an in-memory source replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "cm-source-buffer-"));
  writeFileSync(join(root, "answer.ts"), 'export function answer(){return 11;}\n');
  const index = buildIndex(root), unit = index.units.find(unit => unit.name === "answer")!;
  assert(sourceSlice(index, unit).includes("return 11"));
  index.files[0]!.source = index.files[0]!.source.replace("return 11", "return 22");
  assert(sourceSlice(index, unit).includes("return 22"));
});
