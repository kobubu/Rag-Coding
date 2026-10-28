import type { SourceSpan } from "../code-memory/types.js";
export type Topic = {
    id: string;
    label: string;
    x: number;
    y: number;
    color: string;
    files: number;
    basis: "names-and-paths";
};
export type MapNode = {
    id: string;
    label: string;
    path: string;
    topic: string;
    x: number;
    y: number;
    symbols: number;
};
export type MapEdge = {
    from: string;
    to: string;
    predicate: string;
    count: number;
    evidence_id: string;
    status: "compiler-fact";
};
export type MapData = {
    snapshot_id: string;
    project_name: string;
    topics: Topic[];
    nodes: MapNode[];
    edges: MapEdge[];
    omitted_edges: number;
    counts: {
        files: number;
        symbols: number;
        units: number;
        relations: number;
    };
    concept_method: "inferred-from-names-and-paths";
};
export type NodeInfo = {
    id: string;
    name: string;
    path: string;
    kind: string;
    span: SourceSpan;
    owner_unit_id?: string;
    qualified_name?: string;
};
export type SourceView = {
    snapshot_id: string;
    node: NodeInfo;
    span: SourceSpan;
    text: string;
    next_line: number | null;
    next_byte: number | null;
    total_lines: number;
    partial: boolean;
};
export type RelatedGraph = {
    snapshot_id: string;
    nodes: NodeInfo[];
    edges: {
        id: string;
        from_id: string;
        to_id: string;
        predicate: string;
        evidence: SourceSpan;
        evidence_path: string;
    }[];
    truncated: boolean;
};
export type SymbolPage = {
    snapshot_id: string;
    symbols: NodeInfo[];
    total: number;
    offset: number;
    next_offset: number | null;
};
export type Similarity = {
    snapshot_id: string;
    status: "semantic-candidate";
    embedding_model: string;
    matches: (NodeInfo & {
        score: number;
    })[];
};
