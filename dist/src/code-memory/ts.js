import { createRequire } from "node:module";
// Loading TypeScript costs about 0.4 s per process. Retrieval from a ready index never needs it,
// so the compiler is loaded on first use (indexing, block chunking, the current-file route).
let loaded;
export const ts = new Proxy({}, {
    get: (_target, key) => (loaded ??= createRequire(import.meta.url)("typescript"))[key],
});
