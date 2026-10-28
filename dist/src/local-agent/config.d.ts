import type { AgentConfig } from "./service.js";
export declare function agentOptions(args: string[]): AgentConfig & {
    port: number;
};
