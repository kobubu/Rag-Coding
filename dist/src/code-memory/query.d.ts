import type { CMIndex, CMRelation, CMSymbol, CMUnit, SourceSpan } from "./types.js";
export declare function bounded(value: number | undefined, fallback: number, maximum: number, name: string): number;
export declare function symbolSearch(index: CMIndex, query: string, limit?: number): {
    total: number;
    truncated: boolean;
    matches: {
        score: number;
        id: string;
        name: string;
        qualified_name: string;
        kind: string;
        path: string;
        span: SourceSpan;
        declaration_span: SourceSpan;
        owner_unit_id: string;
    }[];
    memory: string;
    snapshot_id: string;
    capabilities: string[];
    diagnostics_count: number;
    limits: string[];
};
export declare function codeSearch(index: CMIndex, query: string, limit?: number): {
    channels: string[];
    total: number;
    truncated: boolean;
    matches: {
        score: number;
        preview: string;
        id: string;
        path: string;
        name: string;
        kind: "file" | "type" | "function" | "method" | "block";
        parent_id: string | null;
        span: SourceSpan;
        required_symbol_ids: string[];
    }[];
    memory: string;
    snapshot_id: string;
    capabilities: string[];
    diagnostics_count: number;
    limits: string[];
};
export declare function contextGet(index: CMIndex, id: string, maxBytes?: number): {
    requested_id: string;
    max_bytes: number;
    bytes_used: number;
    completeness: string;
    items: {
        text: string;
        id: string;
        path: string;
        span: SourceSpan;
        reason: string;
    }[];
    omissions: {
        id: string;
        reason: string;
    }[];
    diagnostics: string[];
    memory: string;
    snapshot_id: string;
    capabilities: string[];
    diagnostics_count: number;
    limits: string[];
};
export declare function graphExpand(index: CMIndex, id: string, depth?: number, maxNodes?: number, predicate?: string): {
    anchor_id: string;
    direction: string;
    depth: number;
    truncated: boolean;
    nodes: (CMUnit | CMSymbol)[];
    edges: CMRelation[];
    memory: string;
    snapshot_id: string;
    capabilities: string[];
    diagnostics_count: number;
    limits: string[];
};
