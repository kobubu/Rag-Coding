import type { CMIndex } from "./types.js";
export declare function validateIndex(value: unknown): CMIndex;
export declare class CMStore {
    readonly projectRoot: string;
    readonly indexPath: string;
    private cached;
    constructor(projectRoot: string, indexPath: string);
    load(signal: AbortSignal, expectedSnapshot?: string): Promise<CMIndex>;
}
