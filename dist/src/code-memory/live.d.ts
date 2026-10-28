import { CMStore } from "./store.js";
import { LocalVectors, EMBEDDING } from "./vector.js";
import type { Embedder } from "./vector.js";
import type { ChunkingStrategy } from "./chunks.js";
import type { CMIndex } from "./types.js";
type Options = {
    projectRoot: string;
    directory: string;
    modelCache: string;
    baseIndex?: string;
    baseVectors?: string;
    chunking?: ChunkingStrategy;
    searchMode?: "exact" | "ann";
    sourceScope?: string;
    embeddingCache?: string;
};
type Pointer = {
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
};
type State = {
    index: CMIndex;
    store: CMStore;
    vectors: LocalVectors;
    pointer: Pointer;
    users: number;
};
export declare class LiveMemory {
    readonly options: Options;
    private readonly embed?;
    readonly root: string;
    readonly directory: string;
    private state;
    private pending;
    private states;
    private readonly rootHash;
    private watcher;
    private readonly watchingSignal;
    private lastError;
    constructor(options: Options, embed?: Embedder | undefined);
    private manifest;
    private readPointer;
    private lock;
    private fromPointer;
    private publish;
    private refresh;
    private atomic;
    ready(signal: AbortSignal, expectedSnapshot?: string): Promise<State>;
    use<T>(signal: AbortSignal, expectedSnapshot: string | undefined, action: (index: CMIndex, vectors: LocalVectors) => Promise<T>): Promise<T>;
    metadata(): Pointer | undefined;
    startWatching(milliseconds?: number): void;
    watchStatus(): {
        watching: boolean;
        last_error: string | null;
    };
    currentVectors(): LocalVectors | undefined;
    close(): void;
}
export {};
