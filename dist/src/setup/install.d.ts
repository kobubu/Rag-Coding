import type { AgentConfig } from "../local-agent/service.js";
import type { Client, StdioConfig } from "./config.js";
export declare const PACKAGE_ROOT: string;
export type SetupOptions = {
    project: string;
    root: string;
    clients: Client[];
    sourceScope?: string;
    seed?: string;
    modelSource?: string;
    download?: boolean;
    prepare?: boolean;
    harnessModel?: string;
    claudeScope?: "local" | "project";
};
export type Installation = {
    format: "cm-install-1";
    version: string;
    project: string;
    root: string;
    id: string;
    name: string;
    clients: Client[];
    packageRoot: string;
    config: AgentConfig;
    server: StdioConfig;
    harnessHome: string;
    harnessBin?: string;
    claudeScope?: "local" | "project";
    files: string[];
    installedAt: string;
};
export declare function projectId(project: string): string;
export declare function installation(root: string, project: string): Promise<Installation>;
export declare function install(options: SetupOptions): Promise<{
    status: string;
    version: string;
    project: string;
    server: string;
    clients: Client[];
    directory: string;
    readiness: unknown;
}>;
export declare function remove(root: string, project: string): Promise<{
    status: string;
    project: string;
    data_preserved: boolean;
    runtime_preserved: boolean;
}>;
