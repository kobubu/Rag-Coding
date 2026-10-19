import { LocalCM } from "../local-agent/service.js";
import type { AgentConfig } from "../local-agent/service.js";
import type { HookReply } from "./client.js";
export { daemonAddress, ask, ping } from "./client.js";
export type { HookReply } from "./client.js";
export declare const IDLE_MS: number;
export declare function answer(service: LocalCM, prompt: string): Promise<HookReply>;
export declare function serve(config: AgentConfig, idleMs?: number): Promise<string>;
