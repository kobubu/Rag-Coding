import { LocalVectors } from "./vector.js";
import type { CMIndex } from "./types.js";
import type { RetrievedContext } from "./retrieve.js";
export type RetrievalPolicy = "hybrid" | "graph" | "adaptive";
export type RetrievalDetail = "focused" | "expanded";
export declare function retrieveGraph(index: CMIndex, vectors: LocalVectors, query: string, maxBytes?: number, signal?: AbortSignal, policy?: "graph" | "adaptive", detail?: RetrievalDetail): Promise<RetrievedContext>;
