import type { RetrievedContext } from "./retrieve.js";
export declare function directFileContext(root: string, query: string, budget: number, signal?: AbortSignal, scope?: string): Promise<RetrievedContext | undefined>;
