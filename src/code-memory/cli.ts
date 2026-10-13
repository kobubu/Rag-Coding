#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildIndex } from "./indexer.js";
import { CMError } from "./source.js";
import { validateIndex } from "./store.js";

const args = process.argv.slice(2);
let root = process.cwd();
let output: string | undefined;
for (let index = 0; index < args.length; index++) {
  const name = args[index];
  const value = args[++index];
  if ((name !== "--project" && name !== "--out") || !value || value.startsWith("--")) {
    throw new CMError("invalid_argument", "Usage: cm-index [--project directory] [--out index.json]");
  }
  if (name === "--project") root = resolve(value); else output = resolve(value);
}
output ??= resolve(root, ".code-memory/index.json");
const memory = validateIndex(buildIndex(root));
const serialized = JSON.stringify(memory);
if (Buffer.byteLength(serialized, "utf8") > 16 * 1024 * 1024) {
  throw new CMError("index_limit", "Derived index exceeds 16 MiB; select a smaller corpus");
}
mkdirSync(dirname(output), { recursive: true });
const temporary = output + "." + randomUUID() + ".tmp";
writeFileSync(temporary, serialized, { encoding: "utf8", flag: "wx" });
renameSync(temporary, output);
console.log(JSON.stringify({ memory: "CM — Code Memory", index: output, snapshot_id: memory.snapshot_id,
  files: memory.files.length, symbols: memory.symbols.length, units: memory.units.length, relations: memory.relations.length,
  diagnostics: memory.diagnostics.length, source_executed: false }));
