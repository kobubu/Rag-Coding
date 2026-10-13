import { mkdir, open, readFile, rename, rm, copyFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { realpathSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { buildIndex, sourcePaths, analysisInputs } from "./indexer.js";
import { CMStore } from "./store.js";
import { buildVectors, buildAnn, LocalVectors, EMBEDDING } from "./vector.js";
import type { Embedder } from "./vector.js";
import type { ChunkingStrategy } from "./chunks.js";
import type { CMIndex } from "./types.js";
import { CMError, hash, inside } from "./source.js";

type Options = { projectRoot: string; directory: string; modelCache: string; baseIndex?: string; baseVectors?: string; chunking?: ChunkingStrategy;
  searchMode?: "exact" | "ann"; sourceScope?: string; embeddingCache?: string };
type Pointer = { format: "cm-live-1"; root_hash: string; generation: string; snapshot_id: string; source_signature: string; chunking: string; embedding: typeof EMBEDDING;
  published_at: string; changed_paths: string[]; build_ms: number; embedded: number; reused: number };
type State = { index: CMIndex; store: CMStore; vectors: LocalVectors; pointer: Pointer; users: number };
export class LiveMemory {
  readonly root: string;readonly directory: string;
  private state: State | undefined;
  private pending: Promise<State> | undefined;
  private states = new Set<State>();
  private readonly rootHash: string;
  private watcher: ReturnType<typeof setInterval> | undefined;
  private readonly watchingSignal = new AbortController();
  private lastError: string | undefined;
  constructor(readonly options: Options, private readonly embed?: Embedder) {
    this.root = realpathSync(options.projectRoot);this.directory = resolve(options.directory);this.rootHash = hash(this.root);
    if (options.sourceScope && (!inside(this.root, resolve(this.root, options.sourceScope)) || options.sourceScope.includes(".."))) throw new CMError("invalid_argument", "Invalid source scope");
  }
  private manifest() {
    const paths = sourcePaths(this.root).filter(path => !this.options.sourceScope || path.startsWith(this.options.sourceScope.replace(/\\/g, "/").replace(/\/$/, "") + "/"));
    const files = paths.map(path => ({ path, sha256: hash(readFileSync(join(this.root, path))) }));
    const inputs = analysisInputs(this.root);
    return { paths, files, inputs, signature: hash(JSON.stringify([files, inputs])) };
  }
  private async readPointer(): Promise<Pointer | undefined> {
    try {
      const pointer = JSON.parse(await readFile(join(this.directory, "current.json"), "utf8")) as Pointer;
      if (pointer.format !== "cm-live-1" || pointer.root_hash !== this.rootHash || !/^[0-9a-f]{16}$/.test(pointer.generation) || !/^snapshot:[0-9a-f]{64}$/.test(pointer.snapshot_id) || pointer.generation !== pointer.snapshot_id.slice(9, 25) ||
        pointer.chunking !== (this.options.chunking ?? "unit") || JSON.stringify(pointer.embedding) !== JSON.stringify(EMBEDDING)) throw new CMError("invalid_index", "Live memory scope/model/policy mismatch");
      return pointer;
    } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;throw error; }
  }
  private async lock(signal: AbortSignal) {
    await mkdir(this.directory, { recursive: true });const path = join(this.directory, "writer.lock"), token = randomUUID(), deadline = performance.now() + 30000;
    while (true) {
      signal.throwIfAborted();
      try {
        const file = await open(path, "wx");await file.writeFile(JSON.stringify({ pid: process.pid, token }));
        return async () => { await file.close();const current = JSON.parse(await readFile(path, "utf8"));if (current.token === token) await rm(path); };
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
        try {
          const owner = JSON.parse(await readFile(path, "utf8"));
          if (Number.isInteger(owner.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") { await rm(path);continue; } }
          }
        } catch { /* A partially written/live lock must settle before retry. */ }
        if (performance.now() >= deadline) throw new CMError("index_not_ready", "Another CM writer is still updating this project");
        await setTimeout(75, undefined, { signal });
      }
    }
  }
  private async fromPointer(pointer: Pointer, signal: AbortSignal) {
    if (this.state?.pointer.snapshot_id === pointer.snapshot_id) return this.state;
    const base = join(this.directory, "generations", pointer.generation), store = new CMStore(this.root, join(base, "index.json"));
    const index = await store.load(signal, pointer.snapshot_id);
    const vectors = new LocalVectors({ directory: join(base, "vectors"), modelCache: this.options.modelCache, chunking: this.options.chunking ?? "unit", searchMode: this.options.searchMode ?? "exact" }, this.embed);
    try { await vectors.metadata(index, signal); } catch (error) { vectors.close();throw error; }
    const state = { index, store, vectors, pointer, users: 0 };this.states.add(state);return state;
  }
  private publish(state: State) {
    this.state = state;
    for (const old of this.states) if (old !== state && !old.users) { old.vectors.close();this.states.delete(old); }
    return state;
  }
  private async refresh(signal: AbortSignal): Promise<State> {
    const current = this.manifest();
    if (this.state?.pointer.source_signature === current.signature) return this.state;
    const pointer = await this.readPointer();
    if (pointer?.source_signature === current.signature) return this.publish(await this.fromPointer(pointer, signal));
    if (!pointer && this.options.baseIndex && this.options.baseVectors) {
      try {
        const store = new CMStore(this.root, this.options.baseIndex), index = await store.load(signal);
        if (hash(JSON.stringify([index.files.map(file => ({ path: file.path, sha256: file.sha256 })), index.analysis_inputs])) === current.signature) {
          const vectors = new LocalVectors({ directory: this.options.baseVectors, modelCache: this.options.modelCache, chunking: this.options.chunking ?? "unit", searchMode: this.options.searchMode ?? "exact" }, this.embed);
          await vectors.metadata(index, signal);
          const initial: Pointer = { format: "cm-live-1", root_hash: this.rootHash, generation: index.snapshot_id.slice(9, 25), snapshot_id: index.snapshot_id, source_signature: current.signature,
            chunking: this.options.chunking ?? "unit", embedding: EMBEDDING, published_at: new Date().toISOString(), changed_paths: [], build_ms: 0, embedded: 0, reused: 0 };
          const state = { index, store, vectors, pointer: initial, users: 0 };this.states.add(state);return this.publish(state);
        }
      } catch (error) { if (signal.aborted) throw error; /* Rebuild a missing/outdated base; a new generation must still pass all fences. */ }
    }
    const unlock = await this.lock(signal);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        signal.throwIfAborted();const before = this.manifest(), started = performance.now();
        let index: CMIndex;
        try { index = buildIndex(this.root, before.paths); } catch (error) { if (error instanceof CMError && error.code === "source_changed_during_index") continue;throw error; }
        const generation = index.snapshot_id.slice(9, 25), base = join(this.directory, "generations", generation);
        if (index.limits.includes("syntax_analysis_incomplete")) throw new CMError("partial_analysis", "Live source has syntax errors; no new CM generation was published");
        const staging = base + "." + randomUUID().slice(0, 8) + ".pending";
        const cache = this.options.embeddingCache ?? join(this.directory, "embedding-cache.json");
        if (this.options.baseVectors) {
          try { await stat(cache); } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") { try { await copyFile(join(this.options.baseVectors, "embedding-cache.json"), cache); } catch { /* No reusable cache available. */ } } else throw error;
          }
        }
        let built: { embedded: number; reused: number };
        try {
          const existing = new CMStore(this.root, join(base, "index.json"));await existing.load(signal, index.snapshot_id);
          const prior = new LocalVectors({ directory: join(base, "vectors"), modelCache: this.options.modelCache, chunking: this.options.chunking ?? "unit", searchMode: this.options.searchMode ?? "exact" }, this.embed);
          try { const metadata = await prior.metadata(index, signal);built = { embedded: 0, reused: metadata.rows }; } finally { prior.close(); }
        } catch (error) {
          if (signal.aborted) throw error;
          await mkdir(staging, { recursive: true });
          const config = { directory: join(staging, "vectors"), modelCache: this.options.modelCache, embeddingCache: cache, chunking: this.options.chunking ?? "unit" };
          built = await buildVectors(index, config, this.embed, signal);if (this.options.searchMode === "ann") await buildAnn(index, config);
          await this.atomic(join(staging, "index.json"), JSON.stringify(index));await rename(staging, base);
        }
        if (this.manifest().signature !== before.signature) continue;
        const old = new Map(this.state?.index.files.map(file => [file.path, file.sha256]) ?? []), next = new Map(index.files.map(file => [file.path, file.sha256]));
        const changed = [...new Set([...old.keys(), ...next.keys()])].filter(path => old.get(path) !== next.get(path));
        const published: Pointer = { format: "cm-live-1", root_hash: this.rootHash, generation, snapshot_id: index.snapshot_id, source_signature: before.signature,
          chunking: this.options.chunking ?? "unit", embedding: EMBEDDING, published_at: new Date().toISOString(), changed_paths: changed, build_ms: performance.now() - started, embedded: built.embedded, reused: built.reused };
        const ready = await this.fromPointer(published, signal);
        if (this.manifest().signature !== before.signature) { ready.vectors.close();this.states.delete(ready);continue; }
        await this.atomic(join(this.directory, "current.json"), JSON.stringify(published, null, 2));return this.publish(ready);
      }
      throw new CMError("source_changed_during_index", "Project kept changing during three CM rebuild attempts");
    } finally { await unlock(); }
  }
  private async atomic(path: string, text: string) { const temporary = path + "." + randomUUID() + ".tmp";const file = await open(temporary, "wx");try { await file.writeFile(text);await file.sync(); } finally { await file.close(); }await rename(temporary, path); }
  async ready(signal: AbortSignal, expectedSnapshot?: string) {
    signal.throwIfAborted();
    this.watchingSignal.signal.throwIfAborted();
    if (!this.pending) {
      const task = this.refresh(this.watchingSignal.signal);this.pending = task;
      void task.finally(() => { if (this.pending === task) this.pending = undefined; }).catch(() => {});
    }
    const pending = this.pending;
    const state = await new Promise<State>((done, fail) => {
      const abort = () => { signal.removeEventListener("abort", abort);fail(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      pending.then(value => { signal.removeEventListener("abort", abort);done(value); }, error => { signal.removeEventListener("abort", abort);fail(error); });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();if (expectedSnapshot && expectedSnapshot !== state.index.snapshot_id) throw new CMError("snapshot_mismatch", "The live project has a newer CM snapshot");
    return state;
  }
  async use<T>(signal: AbortSignal, expectedSnapshot: string | undefined, action: (index: CMIndex, vectors: LocalVectors) => Promise<T>): Promise<T> {
    const state = await this.ready(signal, expectedSnapshot);state.users++;
    try { const result = await action(state.index, state.vectors);signal.throwIfAborted();if (this.manifest().signature !== state.pointer.source_signature) throw new CMError("index_outdated", "Source changed during the CM query; retry against the new snapshot");return result; }
    finally { state.users--;if (this.state !== state && !state.users) { state.vectors.close();this.states.delete(state); } }
  }
  metadata() { return this.state?.pointer; }
  startWatching(milliseconds = 1000) {
    if (this.watcher) return;
    this.watcher = setInterval(() => { void this.ready(this.watchingSignal.signal).then(() => { this.lastError = undefined; }, error => { this.lastError = String(error).slice(0, 400); }); }, milliseconds);
    this.watcher.unref();
  }
  watchStatus() { return { watching: Boolean(this.watcher), last_error: this.lastError ?? null }; }
  currentVectors() { return this.state?.vectors; }
  close() { if (this.watcher) clearInterval(this.watcher);this.watcher = undefined;this.watchingSignal.abort();for (const state of this.states) state.vectors.close();this.states.clear();this.state = undefined; }
}
