import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { realpath } from "node:fs/promises";
import { text } from "./files.js";
import { CMError } from "../code-memory/source.js";
import { transaction } from "./files.js";
const exec = promisify(execFile);
export async function checkClaudeRoot(project) {
    let root;
    try {
        root = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd: project, timeout: 5000, windowsHide: true })).stdout.trim();
    }
    catch {
        return;
    }
    if (await realpath(root) !== project)
        throw new CMError("invalid_argument", "Claude local MCP uses the repository root. Choose that ProjectRoot and use SourceScope for a subtree");
}
async function entry(project, name) {
    const file = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json");
    const raw = await text(file);
    if (!raw)
        return;
    const document = JSON.parse(raw.replace(/^\uFEFF/, ""));
    const normalized = (value) => value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
    return Object.entries(document.projects ?? {}).find(([path]) => normalized(path) === normalized(project))?.[1].mcpServers?.[name];
}
async function command(project, args) {
    try {
        await exec("claude", ["mcp", ...args], { cwd: project, windowsHide: true, timeout: 45000, maxBuffer: 1048576 });
    }
    catch {
        throw new CMError("client_config_failed", "Claude Code local registration failed. Verify the claude command is installed and its configuration is writable");
    }
}
export async function withClaude(edits, project, name, desired, previous) {
    const before = await entry(project, name), after = desired ? { type: "stdio", ...desired } : undefined;
    const expected = previous ? { type: "stdio", ...previous } : after;
    if (before && !isDeepStrictEqual(before, expected))
        throw new CMError("config_conflict", "Claude local CM entry was changed; existing configuration was preserved");
    const same = isDeepStrictEqual(before, after);
    let changed = false;
    try {
        if (!same) {
            if (before) {
                await command(project, ["remove", "--scope", "local", name]);
                changed = true;
            }
            if (after) {
                await command(project, ["add-json", "--scope", "local", name, JSON.stringify(after)]);
                changed = true;
            }
        }
        await transaction(edits);
    }
    catch (error) {
        if (changed) {
            try {
                const current = await entry(project, name);
                if (current && !isDeepStrictEqual(current, after))
                    throw new CMError("config_changed", "Claude entry changed during rollback");
                if (current)
                    await command(project, ["remove", "--scope", "local", name]);
                if (before)
                    await command(project, ["add-json", "--scope", "local", name, JSON.stringify(before)]);
            }
            catch (rollback) {
                throw new AggregateError([error, rollback], "Setup failed; changed Claude settings were preserved during rollback");
            }
        }
        throw error;
    }
}
