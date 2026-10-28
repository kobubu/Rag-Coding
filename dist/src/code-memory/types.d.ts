export type SourceSpan = {
    file_version_id: string;
    start_byte: number;
    end_byte: number;
    line_start: number;
    line_end: number;
};
export type CMFile = {
    path: string;
    sha256: string;
    source: string;
};
export type CMUnit = {
    id: string;
    path: string;
    name: string;
    kind: "file" | "type" | "function" | "method" | "block";
    parent_id: string | null;
    span: SourceSpan;
    required_symbol_ids: string[];
};
export type CMSymbol = {
    id: string;
    name: string;
    qualified_name: string;
    kind: string;
    path: string;
    span: SourceSpan;
    declaration_span: SourceSpan;
    owner_unit_id: string;
};
export declare const PREDICATES: readonly ["contains", "references", "calls", "captures"];
export type Predicate = typeof PREDICATES[number];
export type CMRelation = {
    id: string;
    from_id: string;
    to_id: string;
    predicate: Predicate;
    evidence: SourceSpan;
};
export type CMIndex = {
    format: "code-memory-0.1";
    snapshot_id: string;
    analysis_config_hash: string;
    analysis_inputs: {
        path: string;
        sha256: string;
    }[];
    analyzer: {
        name: "typescript-compiler";
        version: string;
    };
    capabilities: string[];
    files: CMFile[];
    units: CMUnit[];
    symbols: CMSymbol[];
    relations: CMRelation[];
    diagnostics: {
        path: string;
        code: number;
        message: string;
    }[];
    limits: string[];
};
