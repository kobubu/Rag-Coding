export declare function hash(value: Uint8Array | string): string;
export declare function inside(root: string, path: string): boolean;
export declare function snapshotId(files: {
    path: string;
    sha256: string;
}[], compiler: string, configHash: string): string;
export declare const ANALYSIS_FILES: string[];
export declare const MAX_INDEX_BYTES: number;
export declare function isSourcePath(path: string): boolean;
export declare function byteOffsets(source: string): Int32Array;
export declare class CMError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function utf8(raw: Uint8Array): string;
