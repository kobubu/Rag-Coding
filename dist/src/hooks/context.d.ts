export declare const GUIDANCE: string;
export declare const CLAUDE_GUIDANCE: string;
export type HookClient = "codex" | "claude";
export declare function hookOutput(context: string, client?: HookClient): string;
