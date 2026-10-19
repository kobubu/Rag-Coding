import type { Socket } from "node:net";
import type { AgentConfig } from "../local-agent/service.js";
export type HookReply = {
    text: string;
    bytes: number;
    paths: string[];
    route: string;
    omissions: number;
    ms: number;
};
export declare function daemonAddress(config: AgentConfig): string;
export declare function readLine(socket: Socket, limit: number): Promise<string>;
/** Sends one prompt to a running daemon; rejects quickly when none is listening. */
export declare function ask(address: string, prompt: string, timeoutMs?: number): Promise<HookReply>;
export declare const ping: (address: string) => Promise<unknown>;
