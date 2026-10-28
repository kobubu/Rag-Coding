#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { agentOptions } from "../local-agent/config.js";
import { LocalCM } from "../local-agent/service.js";
import { createMcpServer } from "./server.js";
const config = agentOptions(process.argv.slice(2));
const service = new LocalCM(config);
const server = createMcpServer(service);
server.server.onclose = () => service.close();
await server.connect(new StdioServerTransport());
for (const name of ["SIGINT", "SIGTERM"])
    process.once(name, () => { void server.close().finally(() => service.close()); });
