export declare const GUIDANCE: string;
export declare const CLAUDE_GUIDANCE: string;
export type HookClient = "codex" | "claude";
/** Characters left for the CM context block after the client's guidance, or undefined when the client has no limit. */
export declare function contextLimit(client: HookClient): number | undefined;
export declare function hookOutput(context: string, client?: HookClient): string;
