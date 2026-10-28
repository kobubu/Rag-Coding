import type { Context } from "@deepseek-ai/cordis";
import type { ChunkingStrategy } from "../code-memory/chunks.js";
import type { RetrievalPolicy } from "../code-memory/graph_retrieve.js";
export declare const name = "code-memory";
export declare const inject: string[];
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "code-memory": {
            kind: "code-memory";
            snapshot_id: string;
            form: "snapshot";
            sections: {
                name: string;
                text: string;
            }[];
        };
    }
}
export interface Config {
    projectRoot?: string;
    indexPath?: string;
    mode?: "legacy" | "compact";
    vectorsPath?: string;
    modelCache?: string;
    autoContext?: boolean;
    maxContextBytes?: number;
    diagnosticsPath?: string;
    chunking?: ChunkingStrategy;
    searchMode?: "exact" | "ann";
    retrievalPolicy?: RetrievalPolicy;
    autoUpdate?: boolean;
    backgroundUpdate?: boolean;
    memoryDirectory?: string;
    embeddingCache?: string;
    sourceScope?: string;
}
type Delivered = Map<string, {
    path: string;
    version: string;
    lines: number;
}>;
export declare function rereadPointer(delivered: Delivered, root: string, tool: string, args: unknown): Promise<{
    path: string;
    bytes: number;
    text: string;
} | undefined>;
export declare function apply(ctx: Context, config?: Config): void;
export {};
