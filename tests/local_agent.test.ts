import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { get } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildIndex } from "../src/code-memory/indexer.js";
import { buildVectors, EMBEDDING } from "../src/code-memory/vector.js";
import type { Embedder } from "../src/code-memory/vector.js";
import { LocalCM } from "../src/local-agent/service.js";
import { startViewer } from "../src/local-agent/http.js";
import { mapProjection } from "../src/local-agent/map.js";
import { createMcpServer, contextReply } from "../src/mcp/server.js";

const embed: Embedder = async texts => texts.map(() => { const vector = Array<number>(EMBEDDING.dimensions).fill(0); vector[0] = 1; return vector; });
async function fixture(long = false) {
  const root = mkdtempSync(join(tmpdir(), "cm-agent-"));
  writeFileSync(join(root, "rewards.js"), "export const LIMIT=3;\nexport function allowance(count){return Math.max(0,LIMIT-count);}\n");
  writeFileSync(join(root, "camera.js"), "import {allowance} from './rewards.js';\nexport function shift(x){return allowance(x)+1;}\n");
  if (long) writeFileSync(join(root, "long.js"), 'export const label="' + "Ж😀".repeat(14000) + '";\n');
  const index = buildIndex(root); mkdirSync(join(root, ".code-memory")); writeFileSync(join(root, ".code-memory/index.json"), JSON.stringify(index));
  await buildVectors(index, { directory: join(root, ".code-memory/vectors"), modelCache: root }, embed);
  return { root, index, config: { projectRoot: root, modelCache: root } };
}

test("map preserves all files and evidence-backed endpoints without source blobs or false semantic facts", async () => {
  const data = await fixture(), map = mapProjection(data.index, "Fixture"), ids = new Set(map.nodes.map(node => node.id));
  assert.equal(map.nodes.length, data.index.files.length);
  assert(map.topics.every(topic => topic.basis === "names-and-paths"));
  assert(map.edges.length > 0);
  for (const edge of map.edges) { assert(ids.has(edge.from) && ids.has(edge.to)); assert(data.index.relations.some(relation => relation.id === edge.evidence_id)); assert.equal(edge.status, "compiler-fact"); }
  assert(!JSON.stringify(map).includes("return Math.max"));
  assert(map.nodes.every(node => node.x > 0 && node.x < 1800 && node.y > 0 && node.y < 1100));
});

test("local source pages reconstruct long UTF-8 lines and reject stale snapshots and out-of-scope nodes", async () => {
  const data = await fixture(true), service = new LocalCM(data.config, embed), signal = new AbortController().signal;
  try {
    const ann = new LocalCM({ ...data.config, searchMode: "ann" }, embed);
    try { assert.equal((await ann.status(signal)).projection.status, "unavailable"); }
    finally { ann.close(); }
    const unit = data.index.units.find(unit => unit.path === "long.js" && unit.kind === "file")!;
    let offset: number | undefined, recovered = "";
    do { const view = await service.source(unit.id, undefined, 120, signal, data.index.snapshot_id, offset); assert(Buffer.byteLength(view.text) <= 32000); recovered += view.text; offset = view.next_byte ?? undefined; } while (offset !== undefined);
    assert.equal(recovered, data.index.files.find(file => file.path === "long.js")!.source);
    await assert.rejects(service.source("../../secret", undefined, 100, signal), /unknown_node/);
    await assert.rejects(service.source(unit.id, undefined, 100, signal, "old-snapshot"), /snapshot_mismatch/);
    await assert.rejects(service.source(unit.id, undefined, 100, signal, undefined, 21), /UTF-8/);
    writeFileSync(join(data.root, "camera.js"), "export const changed=true;\n");
    await assert.rejects(service.map(signal), /index_outdated/);
  } finally { service.close(); }
});

test("loopback viewer rejects foreign origins/hosts, writes and arbitrary paths while serving exact current source", async () => {
  const data = await fixture(), service = new LocalCM(data.config, embed), viewer = await startViewer(service, 0, data.root);
  try {
    assert.equal((await fetch(viewer.url + "/api/map")).status, 200);
    assert.equal((await fetch(viewer.url + "/api/map", { headers: { Origin: "https://other.example" } })).status, 403);
    const rawStatus = (headers: Record<string, string>) => new Promise<number>((done, fail) => { get(viewer.url + "/api/map", { headers }, response => { response.resume(); done(response.statusCode!); }).once("error", fail); });
    assert.equal(await rawStatus({ Host: "other.example" }), 403);
    assert.equal(await rawStatus({ "Sec-Fetch-Site": "cross-site" }), 403);
    assert.equal((await fetch(viewer.url + "/api/map", { method: "POST" })).status, 405);
    const unit = data.index.units.find(unit => unit.name === "allowance")!;
    const response = await fetch(viewer.url + "/api/source?id=" + encodeURIComponent(unit.id));
    assert.equal(response.status, 200); assert((await response.json()).text.includes("LIMIT-count"));
    assert.equal((await fetch(viewer.url + "/api/source?id=../../secret")).status, 404);
    assert.equal((await fetch(viewer.url + "/api/source?id=" + encodeURIComponent(unit.id) + "&snapshot=old")).status, 409);
    assert(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  } finally { await viewer.close(); service.close(); }
});

test("MCP handshake, scoped tool/resource calls, cancellation and bounded nonduplicated source work through the official client", async () => {
  const data = await fixture();
  let notifyStart!: () => void, cancelled = false;
  const started = new Promise<void>(resolve => { notifyStart = resolve; });
  const delayed: Embedder = async (texts, signal) => {
    if (texts[0]?.includes("wait-for-cancel")) {
      notifyStart();
      await new Promise<void>((_resolve, reject) => signal!.addEventListener("abort", () => { cancelled = true; reject(signal!.reason); }, { once: true }));
    }
    return embed(texts, signal);
  };
  const service = new LocalCM(data.config, delayed), server = createMcpServer(service), client = new Client({ name: "cm-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const tools = await client.listTools(); assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ["cm_project_status", "cm_retrieve_context"]);
    assert(tools.tools.every(tool => tool.annotations?.readOnlyHint));
    const resource = await client.readResource({ uri: "cm://project/status" }), content = resource.contents[0]!; assert("text" in content); assert.equal(JSON.parse(content.text).scope, "one-configured-project");
    const result = CallToolResultSchema.parse(await client.callTool({ name: "cm_retrieve_context", arguments: { query: "allowance", max_bytes: 300 } }));
    assert.equal(result.isError, undefined); assert(result.content.some(content => content.type === "text" && content.text.includes("LIMIT")));
    assert((result.structuredContent?.bytes_used as number) <= 300); assert(!JSON.stringify(result.structuredContent).includes("Math.max"));
    const stale = await client.callTool({ name: "cm_retrieve_context", arguments: { query: "allowance", snapshot_id: "old" } }); assert.equal(stale.isError, true);
    const abort = new AbortController(); const call = client.callTool({ name: "cm_retrieve_context", arguments: { query: "wait-for-cancel" } }, undefined, { signal: abort.signal });
    await started; abort.abort(Error("cancel-probe")); await assert.rejects(call, /cancel/);
    for (let n = 0; n < 30 && !cancelled; n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(cancelled, "Protocol cancellation did not reach retrieval");
    const span = data.index.units[0]!.span;
    const bounded = contextReply({ snapshot_id: data.index.snapshot_id, channels: [], bytes_used: 100000, parts: [{ path: "a".repeat(50000), span, reason: "match", text: "code".repeat(20000) }], omissions: 0, complete: false });
    assert(Buffer.byteLength(JSON.stringify(bounded)) <= 64000); assert(bounded.structuredContent.omissions > 0);
  } finally { await client.close(); await server.close(); service.close(); }
});
