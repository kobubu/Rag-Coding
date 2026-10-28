import { createServer } from "node:net";
import { unlinkSync } from "node:fs";
import { LocalCM } from "../local-agent/service.js";
import { renderContext } from "../code-memory/retrieve.js";
import { daemonAddress, ping, readLine } from "./client.js";
export { daemonAddress, ask, ping } from "./client.js";
// A per-configuration daemon keeps the index, vectors and embedding model loaded between prompts, so a hook call does not
// pay the cold start (index parse, validation, model and LanceDB load) on every prompt. One daemon serves one CM configuration.
export const IDLE_MS = 30 * 60 * 1000;
const MAX_REQUEST_BYTES = 64 * 1024;
export async function answer(service, prompt) {
    const started = performance.now(), context = await service.retrieve(prompt.slice(0, 16000), 6000, AbortSignal.timeout(60000));
    return { text: renderContext(context, false), bytes: context.bytes_used, paths: [...new Set(context.parts.map(part => part.path))],
        route: context.retrieval?.route ?? "current-file", omissions: context.omissions, ms: Math.round(performance.now() - started),
        whole: context.parts.filter(part => part.whole).map(part => ({ path: part.path, version: part.span.file_version_id, lines: part.span.line_end })) };
}
export async function serve(config, idleMs = IDLE_MS) {
    const address = daemonAddress(config), service = new LocalCM({ ...config, backgroundUpdate: false });
    // Warm the index and, for discovery prompts, the embedding model before the first real prompt arrives.
    await service.retrieve("warm up code memory", 6000, AbortSignal.timeout(120000)).catch(() => undefined);
    let idle, queue = Promise.resolve();
    const server = createServer(socket => {
        clearTimeout(idle);
        idle = setTimeout(stop, idleMs);
        readLine(socket, MAX_REQUEST_BYTES).then(line => {
            // Requests run one at a time: the live index may rebuild before an indexed query and is not shared across rebuilds.
            queue = queue.then(async () => {
                try {
                    const message = JSON.parse(line);
                    socket.end(JSON.stringify(message.ping ? { ok: true, pid: process.pid } : await answer(service, String(message.prompt ?? ""))) + "\n");
                }
                catch (error) {
                    socket.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n");
                }
            });
        }, () => socket.destroy());
    });
    function stop() { server.close(); service.close(); if (process.platform !== "win32")
        try {
            unlinkSync(address);
        }
        catch { /* Already removed. */ } process.exit(0); }
    await new Promise((done, fail) => {
        server.once("error", async (error) => {
            if (error.code !== "EADDRINUSE")
                return fail(error);
            // Another daemon owns the address, or a crashed one left its socket file behind.
            try {
                await ping(address);
                service.close();
                process.exit(0);
            }
            catch {
                if (process.platform !== "win32")
                    unlinkSync(address);
                server.listen(address, done);
            }
        });
        server.listen(address, done);
    });
    idle = setTimeout(stop, idleMs);
    for (const name of ["SIGINT", "SIGTERM"])
        process.once(name, stop);
    return address;
}
