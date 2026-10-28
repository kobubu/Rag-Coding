import { CMStore } from "../code-memory/store.js";
import { EMBEDDING, LocalVectors } from "../code-memory/vector.js";
import type { Embedder } from "../code-memory/vector.js";
import type { CMUnit, CMSymbol } from "../code-memory/types.js";
import type { ChunkingStrategy } from "../code-memory/chunks.js";
import type { RetrievalPolicy, RetrievalDetail } from "../code-memory/graph_retrieve.js";
import type { MapData, NodeInfo, SourceView, RelatedGraph, SymbolPage, Similarity } from "./models.js";
export type AgentConfig = {
    projectRoot: string;
    indexPath?: string;
    vectorsPath?: string;
    modelCache?: string;
    chunking?: ChunkingStrategy;
    searchMode?: "exact" | "ann";
    retrievalPolicy?: RetrievalPolicy;
    autoUpdate?: boolean;
    backgroundUpdate?: boolean;
    memoryDirectory?: string;
    embeddingCache?: string;
    sourceScope?: string;
};
export declare class LocalCM {
    readonly config: AgentConfig;
    readonly store: CMStore;
    private readonly baseVectors;
    private readonly live;
    get vectors(): LocalVectors;
    private cachedMap;
    constructor(config: AgentConfig, embed?: Embedder);
    private load;
    status(signal: AbortSignal): Promise<{
        snapshot_id: string;
        project_name: string;
        process_id: number;
        files: number;
        symbols: number;
        units: number;
        relations: number;
        diagnostics: number;
        projection: {
            status: string;
            rows?: number;
            search_mode?: string;
            ann?: unknown;
            message?: string;
        };
        embedding: {
            readonly model: "Xenova/all-MiniLM-L6-v2";
            readonly revision: "751bff37182d3f1213fa05d7196b954e230abad9";
            readonly dtype: "q8";
            readonly dimensions: 384;
            readonly projection: "cm-hybrid-1";
        };
        retrieval_policy: RetrievalPolicy;
        live_update: {
            generation: {
                format: "cm-live-1";
                root_hash: string;
                generation: string;
                snapshot_id: string;
                source_signature: string;
                chunking: string;
                embedding: typeof EMBEDDING;
                published_at: string;
                changed_paths: string[];
                build_ms: number;
                embedded: number;
                reused: number;
            } | undefined;
            watching: boolean;
            last_error: string | null;
        } | null;
        read_only: boolean;
        scope: string;
    }>;
    retrieve(query: string, maxBytes: number, signal: AbortSignal, snapshot?: string, detail?: RetrievalDetail): Promise<import("../code-memory/retrieve.js").RetrievedContext>;
    map(signal: AbortSignal): Promise<MapData>;
    symbols(query: string, path: string | undefined, offset: number, signal: AbortSignal, snapshot?: string): Promise<SymbolPage>;
    private node;
    source(id: string, startLine: number | undefined, count: number, signal: AbortSignal, snapshot?: string, byteOffset?: number): Promise<SourceView>;
    graph(id: string, signal: AbortSignal, snapshot?: string): Promise<RelatedGraph>;
    similar(id: string, signal: AbortSignal, snapshot?: string): Promise<Similarity>;
    close(): void;
}
export declare function nodeInfo(node: CMUnit | CMSymbol): NodeInfo;
