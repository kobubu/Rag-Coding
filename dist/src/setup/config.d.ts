export type StdioConfig = {
    command: string;
    args: string[];
};
export type Client = "harness" | "codex" | "claude";
export declare function clients(value: string): Client[];
export declare function hookCommand(server: StdioConfig, client?: "codex" | "claude", platform?: string): string;
/** Hook commands written by earlier installers, recognized so a reinstall upgrades them instead of adding a second hook. */
export declare function previousHookCommands(server: StdioConfig, client: "codex" | "claude"): string[];
export declare function codexConfig(before: string, name: string, server: StdioConfig, remove?: boolean, previous?: StdioConfig): string;
export declare function claudeConfig(before: string | undefined, name: string, server: StdioConfig, remove?: boolean): string;
/** Adds or removes the CM UserPromptSubmit hook in a Claude Code settings document, keeping every other setting. */
export declare function claudeHooks(before: string | undefined, command: string, remove?: boolean, previous?: string[]): string | undefined;
export declare function skill(name: string): string;
