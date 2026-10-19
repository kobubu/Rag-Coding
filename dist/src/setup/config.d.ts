export type StdioConfig = {
    command: string;
    args: string[];
};
export type Client = "harness" | "codex" | "claude";
export declare function clients(value: string): Client[];
export declare function codexConfig(before: string, name: string, server: StdioConfig, remove?: boolean, previous?: StdioConfig): string;
export declare function claudeConfig(before: string | undefined, name: string, server: StdioConfig, remove?: boolean): string;
export declare function skill(name: string): string;
