#!/usr/bin/env node
import { resolve } from "node:path";
import { CMStore } from "./store.js";
import { buildAnn } from "./vector.js";
import { agentOptions } from "../local-agent/config.js";
const config = agentOptions(process.argv.slice(2));
const signal = new AbortController().signal;
const index = await new CMStore(config.projectRoot, config.indexPath).load(signal);
console.log(JSON.stringify(await buildAnn(index, { directory: resolve(config.vectorsPath),
    modelCache: resolve(config.modelCache), chunking: config.chunking ?? "unit" })));
