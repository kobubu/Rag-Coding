import { connect } from "node:net";
import type { Socket } from "node:net";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "../code-memory/source.js";
import type { AgentConfig } from "../local-agent/service.js";

// Client side of the CM hook daemon. Kept free of index, vector and compiler imports so a hook answered by a warm
// daemon starts in a fraction of the full CM load.
export type HookReply = { text: string; bytes: number; paths: string[]; route: string; omissions: number; ms: number; whole: { path: string; version: string; lines: number }[] };

// Owner-only directory for daemon sockets and per-session hook state; other local users cannot read or reach it.
export function hookDirectory(): string {
  const directory = join(tmpdir(), "cm-hook-" + userInfo().uid);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = statSync(directory);
  if (stat.uid !== userInfo().uid || (stat.mode & 0o077) !== 0) throw new Error("Unsafe CM hook directory " + directory);
  return directory;
}
// A rebuild or package update rewrites this file, so a daemon left running from the previous build gets a different address
// and is not asked again; it exits after its idle timeout.
const BUILD = (() => { try { return String(statSync(fileURLToPath(import.meta.url)).mtimeMs); } catch { return ""; } })();
export function daemonAddress(config: AgentConfig): string {
  const identity = hash(JSON.stringify({ ...config, backgroundUpdate: false, build: BUILD })).slice(0, 24);
  if (process.platform === "win32") return `\\\\.\\pipe\\cm-hook-${identity}`;
  // Short path keeps the socket under the Unix socket length limit.
  return join(hookDirectory(), identity + ".sock");
}

export function readLine(socket: Socket, limit: number): Promise<string> {
  return new Promise((done, fail) => {
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      data += chunk;
      if (data.length > limit) { socket.destroy();fail(new Error("CM hook message too large")); }
      const end = data.indexOf("\n");if (end >= 0) done(data.slice(0, end));
    });
    socket.on("error", fail);socket.on("end", () => fail(new Error("CM hook connection closed")));
  });
}

/** Sends one prompt to a running daemon; rejects quickly when none is listening. */
export function ask(address: string, prompt: string, timeoutMs = 65000, maxChars?: number): Promise<HookReply> { return send(address, { prompt, ...(maxChars ? { maxChars } : {}) }, timeoutMs) as Promise<HookReply>; }
export const ping = (address: string) => send(address, { ping: true }, 2000);

function send(address: string, message: object, timeoutMs: number): Promise<unknown> {
  return new Promise((done, fail) => {
    const socket = connect(address), timer = setTimeout(() => { socket.destroy();fail(new Error("CM hook daemon timed out")); }, timeoutMs);
    socket.once("error", error => { clearTimeout(timer);fail(error); });
    socket.once("connect", () => {
      socket.write(JSON.stringify(message) + "\n");
      readLine(socket, 1 << 20).then(line => { clearTimeout(timer);socket.end();const reply = JSON.parse(line);reply.error ? fail(new Error(reply.error)) : done(reply); }, error => { clearTimeout(timer);fail(error); });
    });
  });
}
