#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVectors } from "./vector.js";
import { validateIndex } from "./store.js";
import { chunkingPolicy } from "./chunks.js";
const root = resolve(process.argv[2] ?? ".");
const modelCache = resolve(process.argv[3] ?? root + "/.code-memory/models");
const index = validateIndex(JSON.parse(readFileSync(resolve(root, ".code-memory/index.json"), "utf8")));
const strategy = process.argv[4];
chunkingPolicy(strategy);
console.log(JSON.stringify(await buildVectors(index, { directory: resolve(root, ".code-memory/vectors"), modelCache, allowDownload: true, chunking: strategy ?? "unit" })));
