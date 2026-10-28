import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "smol-toml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { codexConfig, claudeConfig, claudeHooks, clients, hookCommand } from "../src/setup/config.js";
import { safeTarget, text, transaction } from "../src/setup/files.js";
import { LocalCM } from "../src/local-agent/service.js";
import { createMcpServer } from "../src/mcp/server.js";
import { agentOptions } from "../src/local-agent/config.js";
import { CM_VERSION } from "../src/version.js";

const server = { command: "D:/CM с пробелами/node.exe", args: ["D:/CM с пробелами/mcp.js", "--project", "D:/Игра"] };
test("Codex install is idempotent and preserves unrelated TOML and comments", () => {
  const before = '\uFEFF# Keep this comment\nmodel = "my-model"\n[mcp_servers.other]\ncommand = "other"\n';
  const after = codexConfig(before, "cm_123", server);
  assert(after.startsWith(before)); assert.equal(codexConfig(after, "cm_123", server), after);
  const parsed = parse(after.replace(/^\uFEFF/, "")); assert.equal(parsed.model, "my-model");
  assert.deepEqual({ ...((parsed.mcp_servers as Record<string, object>).cm_123) }, { ...server, startup_timeout_sec: 60, tool_timeout_sec: 180 });
  assert.equal(codexConfig(after, "cm_123", server, true), before);
  assert.throws(() => codexConfig('[mcp_servers.cm_123]\ncommand="mine"\n', "cm_123", server), /config_conflict/);
  assert.throws(() => codexConfig(after.replace('tool_timeout_sec = 180', 'tool_timeout_sec = 300'), "cm_123", server), /config_conflict/);
});
test("Claude install preserves other servers and rejects an unmanaged collision", () => {
  const unrelated = { command: "other", env: { EXAMPLE_TOKEN: "test-placeholder" } };
  const after = claudeConfig(JSON.stringify({ mcpServers: { other: unrelated }, custom: true }), "cm_123", server);
  assert.deepEqual(JSON.parse(after).mcpServers.other, unrelated);
  assert.equal(claudeConfig(after, "cm_123", server), after);
  const removed = JSON.parse(claudeConfig(after, "cm_123", server, true));
  assert(removed.custom); assert.deepEqual(removed.mcpServers, { other: unrelated });
  assert.throws(() => claudeConfig('{"mcpServers":{"cm_123":{"command":"mine"}}}', "cm_123", server), /config_conflict/);
  assert.throws(() => clients("codex,unexpected"), /invalid_argument/);
});
test("install adds the auto-context hook next to the MCP server and upgrades a server-only Codex block", () => {
  const real = { command: "C:/Program Files/nodejs/node.exe", args: ["C:/CM/dist/src/mcp/cli.js", "--project", "D:/Игра"] };
  const command = hookCommand(real);
  assert.equal(command, '"C:/Program Files/nodejs/node.exe" "C:/CM/dist/src/hooks/cli.js" "--project" "D:/Игра"');
  const codex = parse(codexConfig("", "cm_123", real)) as { hooks: { UserPromptSubmit: { hooks: { command: string; timeout: number }[] }[] } };
  assert.deepEqual({ ...codex.hooks.UserPromptSubmit[0]!.hooks[0] }, { type: "command", command, timeout: 120 });
  const legacy = "# BEGIN Code Memory cm_123\n[mcp_servers.cm_123]\ncommand = " + JSON.stringify(real.command) + "\nargs = " + JSON.stringify(real.args) + "\nstartup_timeout_sec = 60\ntool_timeout_sec = 180\n# END Code Memory cm_123\n";
  assert.equal(codexConfig(legacy, "cm_123", real), codexConfig("", "cm_123", real));
  const other = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "mine" }] }], Stop: [] }, model: "x" };
  const claude = claudeHooks(JSON.stringify(other), command)!;
  assert.equal(claudeHooks(claude, command), claude);
  assert.equal(JSON.parse(claude).hooks.UserPromptSubmit.length, 2);
  assert.deepEqual(JSON.parse(claudeHooks(claude, command, true)!), other);
  assert.equal(claudeHooks(claudeHooks(undefined, command), command, true), undefined);
});
test("configuration transaction restores earlier files when a later file changes concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "cm-install-")), first = join(root, "a"), later = join(root, "b");
  await writeFile(first, "keep"); await writeFile(later, "user changed this");
  await assert.rejects(transaction([{ root, path: first, before: "keep", after: "\uFEFFinstalled" }, { root, path: later, before: "old", after: "new" }]), /config_changed/);
  assert.equal(await readFile(first, "utf8"), "keep"); assert.equal(await readFile(later, "utf8"), "user changed this");
  await transaction([{ root, path: first, before: "keep", after: "\uFEFFinstalled" }]);
  assert.equal(await text(first), "\uFEFFinstalled");
  await transaction([{ root, path: first, before: "\uFEFFinstalled", after: "\uFEFFinstalled" }]);
});
test("setup refuses egress and a junction/symlink in a managed config directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "cm-scope-")), outside = await mkdtemp(join(tmpdir(), "cm-outside-"));
  await mkdir(join(outside, "nested")); await symlink(outside, join(root, ".codex"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(safeTarget(root, join(root, ".codex/config.toml")), /symlink\/junction/);
  await assert.rejects(safeTarget(root, join(outside, "config.toml")), /inside/);
});
test("setup supports an explicitly selected root alias without permitting child link escape", async () => {
  const container = await mkdtemp(join(tmpdir(), "cm-root-alias-")), actual = join(container, "actual"), alias = join(container, "alias");
  await mkdir(actual); await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
  const path = join(alias, "config.toml");
  await transaction([{ root: alias, path, before: undefined, after: "preserved alias" }]);
  assert.equal(await readFile(join(actual, "config.toml"), "utf8"), "preserved alias");
  await symlink(container, join(actual, "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(safeTarget(alias, join(alias, "escape/outside.toml")), /symlink\/junction/);
});
test("MCP adaptive current-file route works without an index and rejects stale file snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "cm-direct-mcp-")); await mkdir(join(root, "src"));
  const path = join(root, "src/камера.ts"); await writeFile(path, "export function camera(){return 1;}\n");
  const service = new LocalCM({ projectRoot: root, retrievalPolicy: "adaptive", autoUpdate: true, backgroundUpdate: false }, async () => { throw Error("Embedding must not run"); });
  const mcp = createMcpServer(service), client = new Client({ name: "installer-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(a); await client.connect(b); assert.equal(client.getServerVersion()?.version, CM_VERSION);
    const call = async (snapshot?: string) => CallToolResultSchema.parse(await client.callTool({ name: "cm_retrieve_context", arguments: { query: "Change src/камера.ts", ...(snapshot ? { snapshot_id: snapshot } : {}) } }));
    const first = await call(); assert(!first.isError); assert(first.content.some(part => part.type === "text" && part.text.includes("return 1")));
    const snapshot = first.structuredContent!.snapshot_id as string; assert(snapshot.startsWith("file:"));
    await writeFile(path, "export function camera(){return 2;}\n");
    const stale = await call(snapshot); assert(stale.isError); assert(JSON.stringify(stale.content).includes("snapshot_mismatch"));
    const fresh = await call(); assert(!fresh.isError); assert(fresh.content.some(part => part.type === "text" && part.text.includes("return 2")));
  } finally { await client.close(); await mcp.close(); service.close(); }
});
test("MCP on-demand refresh is explicit while existing viewer watcher defaults remain compatible", () => {
  assert.equal(agentOptions(["--auto-update", "true", "--background-update", "false"]).backgroundUpdate, false);
  assert.equal(agentOptions([]).backgroundUpdate, undefined);
  assert.throws(() => agentOptions(["--background-update", "yes"]), /invalid_argument/);
});
