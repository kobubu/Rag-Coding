import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { CMError, inside } from "../code-memory/source.js";
import { LocalCM } from "./service.js";

export async function startViewer(service: LocalCM, port = 0, directory = fileURLToPath(new URL("../../viewer/", import.meta.url))) {
  const assets = resolve(directory);
  let origin = "";
  const server = http.createServer(async (request, response) => {
    const signal = new AbortController();
    request.once("aborted", () => signal.abort());
    response.once("close", () => { if (!response.writableEnded) signal.abort(); });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    const send = (status: number, value: unknown) => {
      if (response.destroyed) return;
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value));
    };
    try {
      if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site") {
        send(403, { error: "origin_denied", message: "Open CM through its loopback address" }); return;
      }
      if (request.method !== "GET") { send(405, { error: "read_only", message: "Only GET is available" }); return; }
      const url = new URL(request.url!, origin), query = url.searchParams, snapshot = query.get("snapshot") ?? undefined;
      const number = (key: string, fallback: number) => Number(query.get(key) ?? fallback);
      const id = () => { const value = query.get("id"); if (!value || value.length > 512) throw new CMError("invalid_argument", "A node id is required"); return value; };
      let result: unknown;
      switch (url.pathname) {
        case "/api/status": result = await service.status(signal.signal); break;
        case "/api/map": result = await service.map(signal.signal); break;
        case "/api/search": result = await service.retrieve(query.get("q") ?? "", number("max_bytes", 6000), signal.signal, snapshot); break;
        case "/api/symbols": result = await service.symbols(query.get("q") ?? "", query.get("path") ?? undefined, number("offset", 0), signal.signal, snapshot); break;
        case "/api/source": result = await service.source(id(), query.has("line") ? number("line", 1) : undefined, number("count", 120), signal.signal, snapshot, query.has("byte_offset") ? number("byte_offset", 0) : undefined); break;
        case "/api/graph": result = await service.graph(id(), signal.signal, snapshot); break;
        case "/api/similar": result = await service.similar(id(), signal.signal, snapshot); break;
        default: {
          if (url.pathname.startsWith("/api/")) { send(404, { error: "not_found" }); return; }
          const path = resolve(assets, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
          if (!inside(assets, path)) { send(403, { error: "path_denied" }); return; }
          const bytes = await readFile(path, { signal: signal.signal });
          const type: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
          response.writeHead(200, { "Content-Type": type[extname(path)] ?? "application/octet-stream" }); response.end(bytes); return;
        }
      }
      send(200, result);
    } catch (error) {
      if (signal.signal.aborted) return;
      const code = error instanceof CMError ? error.code : "unavailable";
      send(code === "snapshot_mismatch" || code === "index_outdated" || code === "vectors_outdated" ? 409 : code === "unknown_node" ? 404 : code === "invalid_argument" ? 400 : 503,
        { error: code, message: String(error).slice(0, 1000) });
    }
  });
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", done); });
  const address = server.address() as { port: number };
  origin = "http://127.0.0.1:" + address.port;
  return { url: origin, server, close: async () => { server.closeAllConnections(); await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done())); } };
}
