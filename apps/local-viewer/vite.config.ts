import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({ root: resolve("apps/local-viewer"), build: { outDir: resolve("dist/viewer"), emptyOutDir: true, sourcemap: false } });
