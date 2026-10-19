import type { CMIndex, CMUnit } from "./types.js";
import { chunkingPolicy } from "./chunks.js";
import type { ChunkingStrategy, CMChunk } from "./chunks.js";
export declare const EMBEDDING: {
    readonly model: "Xenova/all-MiniLM-L6-v2";
    readonly revision: "751bff37182d3f1213fa05d7196b954e230abad9";
    readonly dtype: "q8";
    readonly dimensions: 384;
    readonly projection: "cm-hybrid-1";
};
export type Embedder = (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
export type VectorConfig = {
    directory: string;
    modelCache: string;
    embeddingCache?: string;
    allowDownload?: boolean;
    chunking?: ChunkingStrategy;
    searchMode?: "exact" | "ann";
};
export type VectorManifest = {
    format: "cm-vectors-2";
    snapshot_id: string;
    embedding: typeof EMBEDDING;
    chunking: ReturnType<typeof chunkingPolicy>;
    table: string;
    records_hash: string;
    rows: number;
    ann?: {
        type: "IVF_HNSW_SQ";
        partitions: number;
        m: number;
        ef_construction: number;
        ef_search: number;
        refine_factor: number;
    };
};
export declare function localEmbedder(cache: string, allowDownload?: boolean): Embedder;
export declare function sourceSlice(index: CMIndex, unit: CMUnit): string;
export declare function words(text: string): string[];
export declare function buildVectors(index: CMIndex, config: VectorConfig, embed?: Embedder, signal?: AbortSignal): Promise<{
    rows: number;
    embedded: number;
    reused: number;
    milliseconds: number;
    embedding: {
        readonly model: "Xenova/all-MiniLM-L6-v2";
        readonly revision: "751bff37182d3f1213fa05d7196b954e230abad9";
        readonly dtype: "q8";
        readonly dimensions: 384;
        readonly projection: "cm-hybrid-1";
    };
}>;
export declare class LocalVectors {
    readonly config: VectorConfig;
    private readonly embed;
    private opened;
    private projection;
    constructor(config: VectorConfig, embed?: Embedder);
    chunks(index: CMIndex): CMChunk[];
    metadata(index: CMIndex, signal?: AbortSignal): Promise<VectorManifest>;
    search(index: CMIndex, query: string, limit?: number, signal?: AbortSignal): Promise<{
        id: string;
        score: number;
    }[]>;
    close(): void;
}
export declare function buildAnn(index: CMIndex, config: VectorConfig): Promise<{
    rows: number;
    ann: {
        type: "IVF_HNSW_SQ";
        partitions: number;
        m: number;
        ef_construction: number;
        ef_search: number;
        refine_factor: number;
    };
    milliseconds: number;
}>;
