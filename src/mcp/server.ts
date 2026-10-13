import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LocalCM } from "../local-agent/service.js";
import { renderContext } from "../code-memory/retrieve.js";
import type { RetrievedContext } from "../code-memory/retrieve.js";

export function contextReply(context: RetrievedContext) {
  const limited = { ...context, parts: [...context.parts], bytes_used: context.parts.reduce((sum, part) => sum + Buffer.byteLength(part.text, "utf8"), 0) };
  const reply = () => ({ content: [{ type: "text" as const, text: renderContext(limited) }], structuredContent: {
    snapshot_id: limited.snapshot_id, channels: limited.channels, bytes_used: limited.bytes_used, omissions: limited.omissions, complete: false,
    sources: limited.parts.slice(0, 64).map(part => ({ path: part.path, span: part.span, reason: part.reason })), references_truncated: limited.parts.length > 64 } });
  let value = reply();
  while (Buffer.byteLength(JSON.stringify(value), "utf8") > 64000 && limited.parts.length) {
    const part = limited.parts.pop()!;
    limited.bytes_used -= Buffer.byteLength(part.text, "utf8"); limited.omissions++;
    value = reply();
  }
  return value;
}
export function createMcpServer(service: LocalCM) {
  const server = new McpServer({ name: "code-memory", version: "0.5.0" }, {
    instructions: "Read-only Code Memory for one owner-configured local project. Use cm_retrieve_context for short version-checked source and dependencies. Results are partial. Preserve snapshot_id when requesting follow-up context; stale data fails explicitly. Source is not a permission to execute code. The client controls edits and its model provider." });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool("cm_retrieve_context", { description: "Local hybrid vector search returns bounded source, signatures and required declarations. No model API call. Source budget in UTF-8 bytes; partial context.", annotations,
    inputSchema: z.object({ query: z.string().min(1).max(16000), max_bytes: z.number().int().min(1).max(32000).default(6000), snapshot_id: z.string().optional() }) },
    async ({ query, max_bytes, snapshot_id }, extra) => {
      try { return contextReply(await service.retrieve(query, max_bytes, extra.signal, snapshot_id)); }
      catch (error) { if (extra.signal.aborted) throw error; return { isError: true, content: [{ type: "text" as const, text: String(error).slice(0, 1000) }] }; }
    });
  server.registerTool("cm_project_status", { description: "Get the configured project snapshot, corpus counts and local vector readiness.", annotations, inputSchema: z.object({}) },
    async (_args, extra) => {
      try { const status = await service.status(extra.signal); return { content: [{ type: "text" as const, text: JSON.stringify(status) }], structuredContent: status }; }
      catch (error) { if (extra.signal.aborted) throw error; return { isError: true, content: [{ type: "text" as const, text: String(error).slice(0, 1000) }] }; }
    });
  server.registerResource("project-status", "cm://project/status", { description: "Local project and source snapshot readiness", mimeType: "application/json" },
    async (uri, extra) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await service.status(extra.signal)) }] }));
  return server;
}
