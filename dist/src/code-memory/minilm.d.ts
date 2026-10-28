import type { Embedder } from "./vector.js";
export declare function poolNormalized(hidden: Float32Array, mask: BigInt64Array, batch: number, width: number, dimensions: number): number[][];
export declare function miniLMEmbedder(cache: string): Embedder;
