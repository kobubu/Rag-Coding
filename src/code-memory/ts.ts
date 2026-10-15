import { createRequire } from "node:module";
import type TS from "typescript";

// Loading TypeScript costs about 0.4 s per process. Retrieval from a ready index never needs it,
// so the compiler is loaded on first use (indexing, block chunking, the current-file route).
let loaded: typeof TS | undefined;
export const ts = new Proxy({} as typeof TS, {
  get: (_target, key) => (loaded ??= createRequire(import.meta.url)("typescript") as typeof TS)[key as keyof typeof TS],
});
