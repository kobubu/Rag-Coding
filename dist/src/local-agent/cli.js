#!/usr/bin/env node
import { agentOptions } from "./config.js";
import { LocalCM } from "./service.js";
import { startViewer } from "./http.js";
const config = agentOptions(process.argv.slice(2)), service = new LocalCM(config);
await service.status(new AbortController().signal);
const viewer = await startViewer(service, config.port);
console.log(JSON.stringify({ application: "CM Atlas", url: viewer.url, project: config.projectRoot, pid: process.pid, read_only: true }));
for (const name of ["SIGINT", "SIGTERM"])
    process.once(name, () => { void viewer.close().finally(() => { service.close(); process.exit(0); }); });
