import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildVectors, EMBEDDING, LocalVectors } from "../src/code-memory/vector.js";
import type { Embedder } from "../src/code-memory/vector.js";
import { retrieveContext, renderContext } from "../src/code-memory/retrieve.js";
import { Context } from "@deepseek-ai/cordis";
import { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import * as plugin from "../src/harness/plugin.js";

test("compact Harness plugin activates with declared services and disposes its registrations", async () => {
  const ctx = new Context();
  const prompt = await ctx.plugin(SystemPrompt, {});
  const tools = await ctx.plugin(ToolRuntime, {});
  const removeFS = ctx.provide("fs", {});
  const memory = await ctx.plugin(plugin, { mode: "compact", projectRoot: tmpdir() });
  try {
    await new Promise((done) => setTimeout(done, 0));
    assert.deepEqual(ctx.tools.schemas().map((tool) => tool.name), ["cm_retrieve_context"]);
    const assembly = await ctx.systemPrompt.assemble();
    assert(assembly.sections.some((section) => section.text.includes("version-observed")));
    await memory.dispose();
    assert.equal(ctx.tools.schemas().length, 0);
  } finally { await memory.dispose(); await removeFS(); await tools.dispose(); await prompt.dispose(); }
});

const stableEmbeddings: Embedder = async (texts) => texts.map((text) => {
  const vector = Array<number>(EMBEDDING.dimensions).fill(0);
  vector[/camera/.test(text) ? 1 : 0] = 1;
  return vector;
});

test("local vector projection persists, reuses embeddings, fences snapshot/model and returns bounded source context", async () => {
  const root = mkdtempSync(join(tmpdir(), "cm-vectors-"));
  writeFileSync(join(root, "rewards.js"), "export const LIMIT=3;\nexport function rewardsRemaining(count){return Math.max(0,LIMIT-count);}\n");
  writeFileSync(join(root, "camera.js"), "export function moveCamera(camera,dx){camera.x+=dx;}\n");
  const index = buildIndex(root);
  const config = { directory: join(root, "vectors"), modelCache: root };
  const first = await buildVectors(index, config, stableEmbeddings);
  assert(first.embedded > 0);
  const second = await buildVectors(index, config, stableEmbeddings);
  assert.equal(second.embedded, 0);
  const vectors = new LocalVectors(config, stableEmbeddings);
  try {
    const hits = await vectors.search(index, "unused daily advertisement quota");
    assert.equal(index.units.find((unit) => unit.id === hits[0]!.id)!.path, "rewards.js");
    const context = await retrieveContext(index, vectors, "rewardsRemaining", 300);
    assert(context.bytes_used <= 300);
    assert(renderContext(context).includes("const LIMIT=3"));
    assert(!renderContext(context).includes("moveCamera"));
    assert.equal(context.complete, false);
    await assert.rejects(retrieveContext(index, vectors, "", 300), /query/);
    await assert.rejects(retrieveContext(index, vectors, "reward", 32001), /max_bytes/);
    writeFileSync(join(root, "rewards.js"), "export const LIMIT=4;\nexport function rewardsRemaining(count){return Math.max(0,LIMIT-count);}\n");
    await assert.rejects(vectors.search(buildIndex(root), "reward"), /vectors_outdated/);
    const manifestPath = join(root, "vectors/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.embedding.revision = "different-model";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await assert.rejects(vectors.search(index, "reward"), /vectors_outdated/);
  } finally { vectors.close(); }
});
