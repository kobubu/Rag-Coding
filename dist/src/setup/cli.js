#!/usr/bin/env node
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CMError } from "../code-memory/source.js";
import { clients } from "./config.js";
import { install, installation, remove } from "./install.js";
import { CM_VERSION } from "../version.js";
const [action, ...args] = process.argv.slice(2), options = new Map();
const allowed = new Set(["--root", "--project", "--clients", "--client", "--source-scope", "--seed", "--model-source", "--download", "--prepare", "--harness-model", "--port", "--no-open", "--claude-scope"]);
try {
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!allowed.has(key) || !value || value.startsWith("--") || options.has(key))
            throw new CMError("invalid_argument", "Setup options require unique --name value pairs");
        options.set(key, value);
    }
    const root = options.get("--root"), project = options.get("--project");
    if (!root || !project)
        throw new CMError("invalid_argument", "Use cm-setup install|doctor|launch|remove --root installation-directory --project source-directory");
    if (action === "install") {
        const claudeScope = options.get("--claude-scope") ?? "local";
        if (claudeScope !== "local" && claudeScope !== "project")
            throw new CMError("invalid_argument", "claude-scope must be local or project");
        for (const key of ["--download", "--prepare"])
            if (options.has(key) && !["true", "false"].includes(options.get(key)))
                throw new CMError("invalid_argument", "Expected true or false");
        console.log(JSON.stringify(await install({ root, project, clients: clients(options.get("--clients") ?? "harness,codex,claude"),
            download: options.get("--download") === "true", prepare: options.get("--prepare") !== "false", claudeScope,
            ...(options.has("--source-scope") ? { sourceScope: options.get("--source-scope") } : {}), ...(options.has("--seed") ? { seed: options.get("--seed") } : {}),
            ...(options.has("--model-source") ? { modelSource: options.get("--model-source") } : {}), ...(options.has("--harness-model") ? { harnessModel: options.get("--harness-model") } : {}) })));
    }
    else if (action === "remove")
        console.log(JSON.stringify(await remove(root, project)));
    else if (action === "doctor") {
        const state = await installation(root, project), client = new McpClient({ name: "cm-setup-doctor", version: CM_VERSION });
        const transport = new StdioClientTransport({ ...state.server, cwd: state.project, stderr: "pipe" });
        try {
            await client.connect(transport);
            const tools = await client.listTools();
            if (!tools.tools.some(tool => tool.name === "cm_retrieve_context"))
                throw new CMError("connection_failed", "CM retrieval tool missing");
            const status = await client.callTool({ name: "cm_project_status", arguments: {} }, undefined, { timeout: 180000 });
            if (status.isError)
                throw new CMError("connection_failed", "CM project status failed");
            console.log(JSON.stringify({ status: "PASS", server: state.name, tools: tools.tools.map(tool => tool.name), project: state.project,
                connection: "official-mcp-client", version: client.getServerVersion()?.version, state: status.structuredContent, model_api_calls: 0 }));
        }
        finally {
            await client.close();
        }
    }
    else if (action === "launch") {
        const state = await installation(root, project), selected = clients(options.get("--client") ?? "harness");
        if (selected.length !== 1 || !state.clients.includes(selected[0]))
            throw new CMError("invalid_argument", "Choose one installed client");
        const client = selected[0], env = { ...process.env, ...(client === "harness" ? { DSH_HOME: state.harnessHome } : {}) };
        const port = options.get("--port") ?? "61332";
        if (!/^\d+$/.test(port) || Number(port) > 65535)
            throw new CMError("invalid_argument", "Invalid port");
        if (client === "harness" && !state.harnessBin)
            throw new CMError("not_installed", "Harness is not installed");
        const childArgs = client === "harness" ? [state.harnessBin, "--profile", "cm", "--patch", join(state.harnessHome, "cm.patch.json"), "--port", port, ...(options.get("--no-open") === "true" ? ["--no-open"] : [])] : [];
        const child = spawn(client === "harness" ? state.server.command : client === "codex" ? "codex" : "claude", childArgs, { cwd: state.project, env, stdio: "inherit", windowsHide: true });
        child.on("error", error => { console.error("CM launch:", error.message); process.exitCode = 1; });
        child.on("exit", code => { process.exitCode = code ?? 1; });
    }
    else
        throw new CMError("invalid_argument", "Unknown setup action");
}
catch (error) {
    console.error("CM setup:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
