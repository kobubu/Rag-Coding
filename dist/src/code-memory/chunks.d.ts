import type { CMIndex, CMUnit, SourceSpan } from "./types.js";
export declare const CHUNKING_STRATEGIES: readonly ["unit", "window", "ast"];
export type ChunkingStrategy = typeof CHUNKING_STRATEGIES[number];
export type CMChunk = CMUnit & {
    owner_unit_id: string;
    symbol_names: string[];
    signatures: SourceSpan[];
};
export declare function chunkingPolicy(strategy?: ChunkingStrategy): {
    readonly format: "cm-chunks-1";
    readonly strategy: "unit" | "window" | "ast";
    readonly target_bytes: 768;
    readonly overlap_bytes: 128;
};
export declare function projectChunks(index: CMIndex, strategy?: ChunkingStrategy): CMChunk[];
