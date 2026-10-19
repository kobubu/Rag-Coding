import { basename, resolve } from "node:path";
import { CMStore } from "../code-memory/store.js";
import { LiveMemory } from "../code-memory/live.js";
import { EMBEDDING, LocalVectors, sourceSlice } from "../code-memory/vector.js";
import { retrieveContext } from "../code-memory/retrieve.js";
import { directFileContext } from "../code-memory/direct.js";
import { bounded, graphExpand } from "../code-memory/query.js";
import { CMError } from "../code-memory/source.js";
import { mapProjection } from "./map.js";
export class LocalCM {
    config;
    store;
    baseVectors;
    live;
    get vectors() { return this.live?.currentVectors() ?? this.baseVectors; }
    cachedMap;
    constructor(config, embed) {
        this.config = config;
        const root = resolve(config.projectRoot);
        this.store = new CMStore(root, resolve(root, config.indexPath ?? ".code-memory/index.json"));
        const vectorConfig = { directory: resolve(root, config.vectorsPath ?? ".code-memory/vectors"), modelCache: resolve(root, config.modelCache ?? ".code-memory/models"),
            chunking: config.chunking ?? "unit", searchMode: config.searchMode ?? "exact" };
        this.baseVectors = new LocalVectors(vectorConfig, embed);
        this.live = config.autoUpdate ? new LiveMemory({ projectRoot: root, directory: resolve(root, config.memoryDirectory ?? ".code-memory/live"), modelCache: vectorConfig.modelCache,
            baseIndex: this.store.indexPath, baseVectors: vectorConfig.directory, chunking: config.chunking ?? "unit", searchMode: config.searchMode ?? "exact",
            ...(config.embeddingCache ? { embeddingCache: config.embeddingCache } : {}), ...(config.sourceScope ? { sourceScope: config.sourceScope } : {}) }, embed) : undefined;
        if (config.backgroundUpdate !== false)
            this.live?.startWatching();
    }
    async load(signal, snapshot) { return this.live ? (await this.live.ready(signal, snapshot)).index : this.store.load(signal, snapshot); }
    async status(signal) {
        const index = await this.load(signal);
        let projection;
        try {
            const metadata = await this.vectors.metadata(index, signal);
            projection = { status: "ready", rows: metadata.rows, search_mode: this.config.searchMode ?? "exact", ann: metadata.ann ?? null };
        }
        catch (error) {
            if (signal.aborted)
                throw error;
            projection = { status: "unavailable", message: String(error).slice(0, 300) };
        }
        return { snapshot_id: index.snapshot_id, project_name: basename(this.store.projectRoot), process_id: process.pid, files: index.files.length, symbols: index.symbols.length,
            units: index.units.length, relations: index.relations.length, diagnostics: index.diagnostics.length, projection, embedding: EMBEDDING, retrieval_policy: this.config.retrievalPolicy ?? "hybrid",
            live_update: this.live ? { ...this.live.watchStatus(), generation: this.live.metadata() } : null, read_only: true, scope: "one-configured-project" };
    }
    async retrieve(query, maxBytes, signal, snapshot, detail = "focused") {
        if (this.config.retrievalPolicy === "adaptive" && detail === "focused" && (!snapshot || snapshot.startsWith("file:"))) {
            const direct = await directFileContext(this.store.projectRoot, query, maxBytes, signal, this.config.sourceScope);
            if (direct) {
                if (snapshot && snapshot !== direct.snapshot_id)
                    throw new CMError("snapshot_mismatch", "Saved file changed since the requested context");
                return direct;
            }
            if (snapshot?.startsWith("file:"))
                throw new CMError("snapshot_mismatch", "Requested file context is no longer available; retrieve fresh context");
        }
        const action = (index, vectors) => retrieveContext(index, vectors, query, maxBytes, signal, { policy: this.config.retrievalPolicy ?? "hybrid", detail });
        return this.live ? this.live.use(signal, snapshot, action) : action(await this.load(signal, snapshot), this.vectors);
    }
    async map(signal) {
        const index = await this.load(signal);
        if (this.cachedMap?.index !== index)
            this.cachedMap = { index, map: mapProjection(index, basename(this.store.projectRoot)) };
        return this.cachedMap.map;
    }
    async symbols(query, path, offset, signal, snapshot) {
        if (query.length > 256 || !Number.isInteger(offset) || offset < 0 || offset > 100000)
            throw new CMError("invalid_argument", "Invalid symbol query or offset");
        const index = await this.load(signal, snapshot);
        if (path && !index.files.some(file => file.path === path))
            throw new CMError("unknown_node", "Source is outside the indexed corpus");
        const term = query.toLowerCase();
        const symbols = index.symbols.filter(symbol => (!path || path === symbol.path) && (!term || (symbol.name + " " + symbol.qualified_name).toLowerCase().includes(term)));
        return { snapshot_id: index.snapshot_id, symbols: symbols.slice(offset, offset + 100).map(nodeInfo), total: symbols.length, offset, next_offset: offset + 100 < symbols.length ? offset + 100 : null };
    }
    node(index, id) {
        const node = index.units.find(unit => unit.id === id) ?? index.symbols.find(symbol => symbol.id === id) ?? this.vectors.chunks(index).find(chunk => chunk.id === id);
        if (!node)
            throw new CMError("unknown_node", "Node is outside the configured snapshot");
        return node;
    }
    async source(id, startLine, count, signal, snapshot, byteOffset) {
        const index = await this.load(signal, snapshot), node = this.node(index, id);
        const file = index.files.find(file => file.path === node.path), lines = file.source.split("\n");
        const bytes = Buffer.from(file.source, "utf8");
        if (byteOffset !== undefined && (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset >= bytes.length || (bytes[byteOffset] & 0xc0) === 0x80))
            throw new CMError("invalid_argument", "Invalid UTF-8 source offset");
        const first = byteOffset === undefined ? startLine ?? node.span.line_start : bytes.subarray(0, byteOffset).toString("utf8").split("\n").length;
        if (!Number.isInteger(first) || first < 1 || first > lines.length)
            throw new CMError("invalid_argument", "Invalid source line");
        const endLine = Math.min(lines.length, first + bounded(count, 120, 300, "line_count") - 1);
        const startByte = byteOffset ?? Buffer.byteLength(lines.slice(0, first - 1).join("\n") + (first > 1 ? "\n" : ""), "utf8");
        const requestedEnd = Buffer.byteLength(lines.slice(0, endLine).join("\n") + (endLine < lines.length ? "\n" : ""), "utf8");
        let endByte = Math.min(requestedEnd, startByte + 32000);
        while (endByte < bytes.length && (bytes[endByte] & 0xc0) === 0x80)
            endByte--;
        const displayed = bytes.subarray(startByte, endByte).toString("utf8"), actualEnd = bytes.subarray(0, Math.max(startByte, endByte - 1)).toString("utf8").split("\n").length;
        return { snapshot_id: index.snapshot_id, node: nodeInfo(node), text: displayed, span: { ...node.span, start_byte: startByte, end_byte: endByte, line_start: first, line_end: actualEnd },
            total_lines: lines.length, next_line: endByte < bytes.length ? actualEnd + 1 : null, next_byte: endByte < bytes.length ? endByte : null, partial: startByte > 0 || endByte < bytes.length };
    }
    async graph(id, signal, snapshot) {
        const index = await this.load(signal, snapshot), node = this.node(index, id);
        const primary = index.units.some(unit => unit.id === id) || index.symbols.some(symbol => symbol.id === id) ? id : "owner_unit_id" in node ? node.owner_unit_id : id;
        const graph = graphExpand(index, primary, 1, 30);
        const paths = new Map([...index.units, ...index.symbols].map(node => [node.id, node.path]));
        const hashes = new Map(index.files.map(file => [file.path, "blob:" + file.sha256]));
        return { snapshot_id: index.snapshot_id, nodes: graph.nodes.map(nodeInfo),
            edges: graph.edges.map(edge => ({ ...edge, evidence_path: [paths.get(edge.from_id), paths.get(edge.to_id)].find(path => path && hashes.get(path) === edge.evidence.file_version_id) ?? index.files.find(file => "blob:" + file.sha256 === edge.evidence.file_version_id).path })), truncated: graph.truncated };
    }
    async similar(id, signal, snapshot) {
        const action = async (index, vectors) => {
            const node = this.node(index, id), unit = "owner_unit_id" in node ? index.units.find(unit => unit.id === node.owner_unit_id) : node;
            const hits = await vectors.search(index, unit.name + " " + unit.path + " " + sourceSlice(index, unit).slice(0, 1800), 12, signal);
            const chunks = new Map(vectors.chunks(index).map(chunk => [chunk.id, chunk]));
            return { snapshot_id: index.snapshot_id, status: "semantic-candidate", embedding_model: EMBEDDING.model,
                matches: hits.filter(hit => hit.id !== unit.id).slice(0, 6).map(hit => ({ ...nodeInfo(chunks.get(hit.id)), score: hit.score })) };
        };
        return this.live ? this.live.use(signal, snapshot, action) : action(await this.load(signal, snapshot), this.vectors);
    }
    close() { this.live?.close(); this.baseVectors.close(); }
}
export function nodeInfo(node) {
    return { id: node.id, name: node.name, path: node.path, kind: node.kind, span: node.span, ...("owner_unit_id" in node ? { owner_unit_id: node.owner_unit_id } : {}), ...("qualified_name" in node ? { qualified_name: node.qualified_name } : {}) };
}
