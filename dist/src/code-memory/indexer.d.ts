import type { CMIndex } from "./types.js";
export declare function sourcePaths(projectRoot: string): string[];
export declare function analysisInputs(projectRoot: string): {
    path: string;
    sha256: string;
}[];
export declare function buildIndex(projectRoot: string, paths?: string[]): CMIndex;
