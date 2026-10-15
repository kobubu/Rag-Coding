import { cp, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { CMError, hash, inside } from "../code-memory/source.js";
import { EMBEDDING, localEmbedder } from "../code-memory/vector.js";
import { LocalCM } from "../local-agent/service.js";
import type { AgentConfig } from "../local-agent/service.js";
import { CM_VERSION } from "../version.js";
import { claudeConfig, codexConfig, skill } from "./config.js";
import type { Client, StdioConfig } from "./config.js";
import { safeTarget, text, transaction } from "./files.js";
import { checkClaudeRoot, withClaude } from "./claude.js";
import type { Edit } from "./files.js";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export type SetupOptions = { project: string; root: string; clients: Client[]; sourceScope?: string; seed?: string; modelSource?: string;
  download?: boolean; prepare?: boolean; harnessModel?: string; claudeScope?: "local" | "project" };
export type Installation = { format: "cm-install-1"; version: string; project: string; root: string; id: string; name: string; clients: Client[];
  packageRoot: string; config: AgentConfig; server: StdioConfig; harnessHome: string; harnessBin?: string; claudeScope?: "local" | "project"; files: string[]; installedAt: string };
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
export function projectId(project: string) { return hash(project).slice(0, 12); }
const statePath = (root: string, project: string) => join(root, "projects", projectId(project), "installation.json");
export async function installation(root: string, project: string): Promise<Installation> {
  root = await realpath(root); project = await realpath(project);
  const file = statePath(root, project); await safeTarget(root, file);
  const raw = await text(file); if (!raw) throw new CMError("not_installed", "Run CM install for this project first");
  const state = JSON.parse(raw) as Installation;
  if (state.format !== "cm-install-1" || state.project !== project || state.root !== root || state.id !== projectId(project) || state.name !== "cm_" + state.id || !inside(root, state.packageRoot)) {
    throw new CMError("invalid_config", "CM installation identity or package location differs");
  }
  return state;
}
async function copyTree(source: string, target: string, root: string) {
  await safeTarget(root, target);
  async function check(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new CMError("invalid_argument", "Setup cache source contains a symlink/junction");
    if (info.isDirectory()) for (const item of await readdir(path)) await check(join(path, item));
    else if (!info.isFile()) throw new CMError("invalid_argument", "Setup cache source must contain ordinary files");
  }
  await check(source); await mkdir(dirname(target), { recursive: true }); await cp(source, target, { recursive: true, errorOnExist: false });
}
export async function install(options: SetupOptions) {
  const project = await realpath(options.project);
  await mkdir(resolve(options.root), { recursive: true });
  const root = await realpath(options.root), id = projectId(project), name = "cm_" + id, directory = join(root, "projects", id);
  if (!inside(root, PACKAGE_ROOT)) throw new CMError("invalid_argument", "Run the setup CLI from the package installed under InstallRoot");
  if (options.sourceScope) {
    const selected = await realpath(resolve(project, options.sourceScope));
    if (!inside(project, selected) || selected === project || options.sourceScope.includes("..")) throw new CMError("invalid_argument", "Source scope must stay inside the project");
  }
  await safeTarget(root, statePath(root, project));
  const oldRaw = await text(statePath(root, project));
  const old = oldRaw ? await installation(root, project) : undefined;
  const claudeScope = options.claudeScope ?? "local";
  if (options.clients.includes("claude") && claudeScope === "local") await checkClaudeRoot(project);
  if (old?.claudeScope === "local" && claudeScope === "project") throw new CMError("config_conflict", "Remove the local connection before switching Claude scope to project");
  if (old && old.clients.some(client => !options.clients.includes(client))) throw new CMError("config_conflict", "Keep previously installed clients or remove the old connection first");
  const modelCache = join(root, "models"), memory = join(directory, "memory"), base = join(directory, "base");
  const config: AgentConfig = { projectRoot: project, modelCache, indexPath: join(base, "index.json"), vectorsPath: join(base, "vectors"), memoryDirectory: memory,
    chunking: "unit", searchMode: "exact", retrievalPolicy: "adaptive", autoUpdate: true, backgroundUpdate: false,
    ...(options.sourceScope ? { sourceScope: options.sourceScope } : {}) };
  await safeTarget(root, join(directory, "installation.json"));
  await mkdir(directory, { recursive: true });
  const edits: Edit[] = [];
  async function edit(owner: string, path: string, after: string) { await safeTarget(owner, path); edits.push({ root: owner, path, before: await text(path), after }); }
  const server: StdioConfig = { command: process.execPath, args: [join(PACKAGE_ROOT, "dist/src/mcp/cli.js"), "--project", project,
    "--index", config.indexPath!, "--vectors", config.vectorsPath!, "--model-cache", modelCache, "--memory-dir", memory,
    "--retrieval-policy", "adaptive", "--auto-update", "true", "--background-update", "false", ...(options.sourceScope ? ["--source-scope", options.sourceScope] : [])] };
  if (options.clients.includes("codex")) {
    const path = join(project, ".codex/config.toml"); await safeTarget(project, path);
    const before = await text(path) ?? "";
    if (old && old.server.command !== server.command) throw new CMError("config_conflict", "Runtime changed; remove the previous connection before changing Node");
    await edit(project, path, codexConfig(before, name, server, false, old?.server ?? server));
    const pathSkill = join(project, ".agents/skills/code-memory/SKILL.md"); await safeTarget(project, pathSkill); const beforeSkill = await text(pathSkill);
    if (beforeSkill && beforeSkill !== skill(name)) throw new CMError("config_conflict", "Existing Code Memory skill was edited; preserve it before reinstalling");
    await edit(project, pathSkill, skill(name));
  }
  if (options.clients.includes("claude")) {
    const path = join(project, ".mcp.json"); await safeTarget(project, path);
    const before = await text(path);
    if (claudeScope === "project") {
      let prior = before;
      if (old && JSON.stringify(old.server) !== JSON.stringify(server)) prior = claudeConfig(before, name, old.server, true);
      await edit(project, path, claudeConfig(prior, name, server));
    } else if (old?.clients.includes("claude") && old.claudeScope !== "local" && before !== undefined) {
      await edit(project, path, claudeConfig(before, name, old.server, true));
    }
    const pathSkill = join(project, ".claude/skills/code-memory/SKILL.md"); await safeTarget(project, pathSkill); const beforeSkill = await text(pathSkill);
    if (beforeSkill && beforeSkill !== skill(name)) throw new CMError("config_conflict", "Existing Claude Code Memory skill was edited; preserve it before reinstalling");
    await edit(project, pathSkill, skill(name));
  }
  const harnessHome = join(directory, "harness"), profile = join(harnessHome, "profiles/cm");
  let harnessBin: string | undefined;
  if (options.clients.includes("harness")) {
    const require = createRequire(join(PACKAGE_ROOT, "package.json"));
    harnessBin = join(dirname(require.resolve("@deepseek-ai/dsh/profile-boot")), "bin.js");
    const manifestPath = join(profile, "package.json"), manifestText = await text(manifestPath);
    if (!manifestText) await edit(root, manifestPath, json({ name: "cm-harness-profile", private: true,
      dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } } }));
    else {
      const manifest = JSON.parse(manifestText.replace(/^\uFEFF/, "")) as { dsh?: { profile?: { bundles?: string[] } } };
      const bundles = manifest.dsh?.profile?.bundles;
      if (!bundles?.includes("@deepseek-ai/dsh-web-app")) throw new CMError("config_conflict", "The Harness profile was changed; preserve it before reinstalling CM");
      if (bundles.includes("dsh-plugin-code-memory")) { manifest.dsh!.profile!.bundles = bundles.filter(bundle => bundle !== "dsh-plugin-code-memory"); await edit(root, manifestPath, json(manifest)); }
    }
    const patches: object[] = [{ insert: [{ id: "code-memory", name: pathToFileURL(join(PACKAGE_ROOT, "dist/src/harness/plugin.js")).href,
      config: { ...config, mode: "compact", autoContext: true, maxContextBytes: 6000 } }] }];
    if (options.harnessModel) {
      // Harness keys the OpenAI prompt cache by session id, so every new session re-writes the same system/tool prefix.
      // Without a key the provider routes by prefix, and later sessions in the same project read it from cache.
      patches.push({ id: "llm-pi-ai", config: { providers: { "cm-openai": { apiKeyEnv: "OPENAI_API_KEY", api: "openai-responses", baseURL: "https://api.openai.com/v1", cacheRetention: "none",
        models: [{ id: options.harnessModel, name: options.harnessModel, contextWindow: 1050000, maxTokens: 8192, input: ["text"], reasoningEfforts: { low: "low" } }] } } } },
      { id: "agent-default-model", config: { provider: "cm-openai", model: options.harnessModel, reasoningEffort: "low" } });
    }
    await edit(root, join(harnessHome, "cm.patch.json"), json(patches));
  }
  if (options.modelSource && resolve(options.modelSource) !== modelCache) {
    for (const file of ["tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]) {
      await copyTree(join(options.modelSource, EMBEDDING.model, EMBEDDING.revision, file), join(modelCache, EMBEDDING.model, EMBEDDING.revision, file), root);
    }
  }
  try { await localEmbedder(modelCache)(["CM installation check"]); }
  catch (error) {
    if (!options.download) throw error;
    await localEmbedder(modelCache, true)(["CM model bootstrap"]);
    await localEmbedder(modelCache)(["CM installation check"]);
  }
  if (options.seed && !old) {
    const pointerText = await text(join(options.seed, "current.json"));
    if (pointerText) {
      const pointer = JSON.parse(pointerText) as { format?: string; root_hash?: string; generation?: string; chunking?: string };
      if (pointer.format === "cm-live-1" && pointer.root_hash === hash(project) && pointer.chunking === "unit" && /^[a-f0-9]{16}$/.test(pointer.generation ?? "")) {
        const source = join(options.seed, "generations", pointer.generation!);
        await copyTree(join(source, "index.json"), config.indexPath!, root);
        await copyTree(join(source, "vectors"), config.vectorsPath!, root);
      }
    }
  }
  let readiness: unknown = { status: "lazy", note: "First indexed query prepares the selected source corpus" };
  if (options.prepare !== false) {
    const service = new LocalCM(config);
    try { readiness = await service.status(AbortSignal.timeout(600000)); }
    finally { service.close(); }
    if ((readiness as { projection: { status: string } }).projection.status !== "ready") throw new CMError("index_not_ready", "CM projection preparation failed");
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  for (const client of options.clients) {
    const path = join(directory, "start-" + client + ".ps1");
    await edit(root, path, "\uFEFF$ErrorActionPreference = 'Stop'\n& " + [process.execPath, join(PACKAGE_ROOT, "dist/src/setup/cli.js"), "launch", "--root", root, "--project", project, "--client", client].map(quote).join(" ") + "\n");
  }
  const state: Installation = { format: "cm-install-1", version: CM_VERSION, project, root, id, name, clients: options.clients,
    packageRoot: PACKAGE_ROOT, config, server, harnessHome, ...(harnessBin ? { harnessBin } : {}), ...(options.clients.includes("claude") ? { claudeScope } : {}), files: edits.map(edit => edit.path), installedAt: old?.installedAt ?? new Date().toISOString() };
  await edit(root, statePath(root, project), json(state));
  if (options.clients.includes("claude") && claudeScope === "local") await withClaude(edits, project, name, server, old?.claudeScope === "local" ? old.server : undefined);
  else await transaction(edits);
  return { status: "installed", version: CM_VERSION, project, server: name, clients: options.clients, directory, readiness };
}
export async function remove(root: string, project: string) {
  const state = await installation(root, project), edits: Edit[] = [];
  async function edit(path: string, after: string | undefined) { edits.push({ root: state.project, path, before: await text(path), after }); }
  if (state.clients.includes("codex")) {
    const path = join(state.project, ".codex/config.toml"), before = await text(path);
    if (before !== undefined) await edit(path, codexConfig(before, state.name, state.server, true));
  }
  if (state.clients.includes("claude") && state.claudeScope !== "local") {
    const path = join(state.project, ".mcp.json"), before = await text(path);
    if (before !== undefined) await edit(path, claudeConfig(before, state.name, state.server, true));
  }
  for (const relative of [...(state.clients.includes("codex") ? [".agents/skills/code-memory/SKILL.md"] : []), ...(state.clients.includes("claude") ? [".claude/skills/code-memory/SKILL.md"] : [])]) {
    const path = join(state.project, relative), before = await text(path);
    if (before === skill(state.name)) await edit(path, undefined);
    else if (before !== undefined && state.files.includes(path)) throw new CMError("config_conflict", "Edited CM skill was preserved; resolve it before removing the connection");
  }
  const stateFile = statePath(state.root, state.project);
  if (state.clients.includes("harness")) {
    const path = join(state.harnessHome, "cm.patch.json");
    edits.push({ root: state.root, path, before: await text(path), after: json([{ id: "code-memory", disabled: true }]) });
  }
  edits.push({ root: state.root, path: stateFile, before: await text(stateFile), after: undefined });
  if (state.clients.includes("claude") && state.claudeScope === "local") await withClaude(edits, state.project, state.name, undefined, state.server);
  else await transaction(edits);
  return { status: "disconnected", project: state.project, data_preserved: true, runtime_preserved: true };
}
