import { LocalVectors } from "./vector.js";
import type { CMIndex, SourceSpan } from "./types.js";
import type { RetrievalDetail, RetrievalPolicy } from "./graph_retrieve.js";
type ContextPart = {
    path: string;
    span: SourceSpan;
    text: string;
    reason: "match" | "dependency" | "signature";
    whole?: true;
};
export type RetrievedContext = {
    snapshot_id: string;
    channels: string[];
    bytes_used: number;
    parts: ContextPart[];
    omissions: number;
    complete: false;
    retrieval?: {
        policy: RetrievalPolicy;
        route: "named" | "discovery";
        detail: RetrievalDetail;
        roots: number;
        graph_nodes: number;
        bindings_shown: number;
        bindings_omitted: number;
        dense_search: boolean;
    };
    notes?: string[];
};
export declare function retrieveContext(index: CMIndex, vectors: LocalVectors, query: string, maxBytes?: number, signal?: AbortSignal, strategy?: {
    policy: RetrievalPolicy;
    detail?: RetrievalDetail;
}): Promise<RetrievedContext>;
export declare function renderContext(context: RetrievedContext, observed?: boolean): string;
export {};
