import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ROOT } from "../scripts/lib.js";
import { byteOffset, focusedProbe, runFixtureChecks } from "../scripts/probe_chunking.js";

const path = join(ROOT, "fixtures/batching.ts");
const raw = readFileSync(path);

test("LF, CRLF and BOM preserve original bytes and three closure bindings", () => {
  const result = runFixtureChecks();
  assert.equal(result.fixture_variants.length, 3);
  assert.equal(result.code_executed, false);
  for (const { probe } of result.fixture_variants) {
    for (const symbol of probe.nested_function.closure_symbols) assert(symbol.occurrences.length > 0);
    assert.equal(probe.nested_function.standalone_binding_probe.type_checked, false);
  }
});

test("UTF-16 positions map to exact UTF-8 bytes after Cyrillic and an astral character", () => {
  const source = raw.toString("utf8");
  const position = source.indexOf("const batches");
  const offset = byteOffset(source, position);
  assert(offset > position);
  assert.equal(raw.subarray(offset, offset + 13).toString("utf8"), "const batches");
  const astral = source.indexOf("🧩");
  assert.throws(() => byteOffset(source, astral + 1), /surrogate pair/);
});

test("a shadowed local is not confused with the captured outer variable", () => {
  const shadowed = raw.toString("utf8").replace("function flush(): void {", "function flush(): void {\n    let pending: string[] = [];");
  const probe = focusedProbe(Buffer.from(shadowed), path);
  assert.deepEqual(probe.nested_function.closure_symbols.map((item) => item.name).sort(), ["batchNumber", "batches"].sort());
});

test("analysis does not execute a valid source with a throwing top-level statement", () => {
  const throwing = Buffer.concat([raw, Buffer.from('\nthrow new Error("must never execute");\n')]);
  assert.equal(focusedProbe(throwing, path).full_file_typecheck_without_execution, "PASS");
});

test("invalid UTF-8 and malformed syntax fail visibly", () => {
  assert.throws(() => focusedProbe(Buffer.from([0xff]), path), /exact UTF-8/);
  assert.throws(() => focusedProbe(Buffer.from("export function collectBatches( {"), path), /syntax diagnostics/);
});
