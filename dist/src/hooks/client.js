import { connect } from "node:net";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { hash } from "../code-memory/source.js";
export function daemonAddress(config) {
    const identity = hash(JSON.stringify({ ...config, backgroundUpdate: false })).slice(0, 24);
    if (process.platform === "win32")
        return `\\\\.\\pipe\\cm-hook-${identity}`;
    // Owner-only directory: other local users cannot reach the socket. Short path keeps it under the Unix socket length limit.
    const directory = join(tmpdir(), "cm-hook-" + userInfo().uid);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = statSync(directory);
    if (stat.uid !== userInfo().uid || (stat.mode & 0o077) !== 0)
        throw new Error("Unsafe CM hook socket directory " + directory);
    return join(directory, identity + ".sock");
}
export function readLine(socket, limit) {
    return new Promise((done, fail) => {
        let data = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
            data += chunk;
            if (data.length > limit) {
                socket.destroy();
                fail(new Error("CM hook message too large"));
            }
            const end = data.indexOf("\n");
            if (end >= 0)
                done(data.slice(0, end));
        });
        socket.on("error", fail);
        socket.on("end", () => fail(new Error("CM hook connection closed")));
    });
}
/** Sends one prompt to a running daemon; rejects quickly when none is listening. */
export function ask(address, prompt, timeoutMs = 65000) { return send(address, { prompt }, timeoutMs); }
export const ping = (address) => send(address, { ping: true }, 2000);
function send(address, message, timeoutMs) {
    return new Promise((done, fail) => {
        const socket = connect(address), timer = setTimeout(() => { socket.destroy(); fail(new Error("CM hook daemon timed out")); }, timeoutMs);
        socket.once("error", error => { clearTimeout(timer); fail(error); });
        socket.once("connect", () => {
            socket.write(JSON.stringify(message) + "\n");
            readLine(socket, 1 << 20).then(line => { clearTimeout(timer); socket.end(); const reply = JSON.parse(line); reply.error ? fail(new Error(reply.error)) : done(reply); }, error => { clearTimeout(timer); fail(error); });
        });
    });
}
