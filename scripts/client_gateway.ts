import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

export type MeterCall = { run: string; endpoint: string; status: number; elapsed_ms: number; usage: any; response_id?: string; error?: string; permission_context?: string[]; tools?: string[] };
export class ClientGateway {
  readonly calls: MeterCall[] = [];
  readonly token = randomUUID();
  private server = createServer((request, response) => { void this.handle(request, response); });
  private port = 0;
  constructor(private key: string, private onMeter?: (calls: MeterCall[]) => void) {}
  async start() { await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve)); this.port = (this.server.address() as { port: number }).port; }
  url(run: string) { return `http://127.0.0.1:${this.port}/${run}/v1`; }
  close() { this.server.close(); this.server.closeAllConnections(); this.key = ""; }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    const started = performance.now(), match = request.url?.match(/^\/([a-z0-9-]+)\/(v1\/[^?]+)(\?.*)?$/);
    if (!match || request.headers.authorization !== "Bearer " + this.token) { response.writeHead(403).end(); return; }
    const run = match[1]!, endpoint = match[2]!;
    if (!["v1/responses", "v1/responses/compact", "v1/models"].includes(endpoint)) { response.writeHead(404).end(); return; }
    if (this.calls.filter(call => call.run === run && call.endpoint === "v1/responses").length >= 16 || providerTotals(this.calls).usd_estimate >= 2) { response.writeHead(429).end(JSON.stringify({ error: { message: "Predeclared benchmark budget reached" } })); return; }
    const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
    const record: MeterCall = { run, endpoint, status: 0, elapsed_ms: 0, usage: null }; this.calls.push(record); this.onMeter?.(this.calls);
    try { const payload = JSON.parse(Buffer.concat(parts).toString("utf8")); const raw = JSON.stringify(payload.input ?? []); record.permission_context = [...raw.matchAll(/.{0,100}sandbox_mode.{0,220}/g)].map(match => match[0]); record.tools = (payload.tools ?? []).map((tool: any) => tool.name ?? tool.type); } catch {}
    try {
      const upstream = await fetch("https://api.openai.com/" + endpoint + (match[3] ?? ""), { method: request.method!, headers: { Authorization: "Bearer " + this.key, "Content-Type": "application/json" }, ...(request.method === "GET" ? {} : { body: Buffer.concat(parts) }), signal: AbortSignal.timeout(180000) });
      record.status = upstream.status;
      const stream = upstream.headers.get("content-type")?.includes("text/event-stream");
      response.writeHead(upstream.status, { "Content-Type": stream ? "text/event-stream" : "application/json", "Cache-Control": "no-cache" });
      if (stream && upstream.body) {
        let pending = "";
        for await (const chunk of upstream.body) {
          response.write(chunk); pending += Buffer.from(chunk).toString("utf8");
          let split: number;
          while ((split = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, split); pending = pending.slice(split + 2);
            for (const line of frame.split("\n")) if (line.startsWith("data: ")) { try { const event = JSON.parse(line.slice(6)); if (event.response?.usage) { record.usage = event.response.usage; record.response_id = event.response.id; } } catch {} }
          }
        }
        response.end();
      } else {
        const raw = await upstream.text();
        try { const data = JSON.parse(raw); record.usage = data.usage ?? null; record.response_id = data.id; } catch {}
        response.end(raw.replaceAll(this.key, "[redacted]"));
      }
    } catch (error) { record.error = error instanceof Error ? error.name : "GatewayError"; if (!response.headersSent) response.writeHead(502); response.end(JSON.stringify({ error: { message: "Benchmark gateway request failed" } })); }
    finally { record.elapsed_ms = performance.now() - started; this.onMeter?.(this.calls); }
  }
}
export function providerTotals(calls: MeterCall[]) {
  let input = 0, output = 0, cache = 0, write = 0, missing = 0;
  for (const call of calls.filter(call => call.endpoint === "v1/responses")) {
    const usage = call.usage; if (!usage) { missing++; continue; }
    input += usage.input_tokens; output += usage.output_tokens;
    cache += usage.input_tokens_details?.cached_tokens ?? 0;
    write += usage.input_tokens_details?.cache_creation_tokens ?? usage.input_tokens_details?.cache_write_tokens ?? 0;
  }
  return { input, output, cache_read: cache, cache_write: write, total: input + output, missing, usd_estimate: ((input - cache - write) * .1 + cache * .01 + write * .125 + output * .5) / 1e6 };
}
