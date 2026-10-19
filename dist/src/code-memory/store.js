import { readFileSync } from "node:fs";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { ANALYSIS_FILES, CMError, hash, inside, isSourcePath, MAX_INDEX_BYTES, snapshotId, utf8 } from "./source.js";
const schema = JSON.parse(readFileSync(new URL("../../../contracts/cm-local.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
export function validateIndex(value) {
    if (!validate(value))
        throw new CMError("invalid_index", JSON.stringify(validate.errors));
    const index = value;
    if (new Set(index.analysis_inputs.map((input) => input.path)).size !== index.analysis_inputs.length ||
        index.analysis_inputs.some((input) => !ANALYSIS_FILES.includes(input.path) && (!input.path.endsWith(".json") || input.path.includes("\\") || input.path.includes(":") || input.path.split("/").some(part => !part || part === "." || part === ".."))))
        throw new CMError("invalid_index", "Invalid analysis input");
    if (index.snapshot_id !== snapshotId(index.files, index.analyzer.version, index.analysis_config_hash)) {
        throw new CMError("invalid_index", "Snapshot fingerprint does not match manifest");
    }
    const files = new Map(index.files.map((file) => [file.path, file]));
    const units = new Map(index.units.map((unit) => [unit.id, unit]));
    const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
    const relations = new Set(index.relations.map((relation) => relation.id));
    if (files.size !== index.files.length || units.size !== index.units.length || symbols.size !== index.symbols.length ||
        relations.size !== index.relations.length)
        throw new CMError("invalid_index", "Duplicate identities");
    const byBlob = new Map(index.files.map((file) => ["blob:" + file.sha256, file]));
    const rawByBlob = new Map(index.files.map((file) => ["blob:" + file.sha256, Buffer.from(file.source, "utf8")]));
    for (const file of index.files) {
        if (file.path.includes("\\") || file.path.includes(":") || file.path.split("/").some((part) => !part || part === ".." || part === ".") ||
            !isSourcePath(file.path) || hash(Buffer.from(file.source, "utf8")) !== file.sha256) {
            throw new CMError("invalid_index", "Invalid source path or blob hash");
        }
    }
    function checkSpan(span, path) {
        const file = byBlob.get(span.file_version_id);
        if (!file || path && files.get(path)?.sha256 !== file.sha256)
            throw new CMError("invalid_index", "Span belongs to another blob");
        const raw = rawByBlob.get(span.file_version_id);
        if (span.start_byte > span.end_byte || span.end_byte > raw.length || span.line_start > span.line_end)
            throw new CMError("invalid_index", "Invalid source range");
        for (const boundary of [span.start_byte, span.end_byte]) {
            if (boundary < raw.length && (raw[boundary] & 0xc0) === 0x80)
                throw new CMError("invalid_source_range", "Span splits a UTF-8 character");
        }
    }
    for (const unit of index.units) {
        if (symbols.has(unit.id))
            throw new CMError("invalid_index", "Node identity collision");
        checkSpan(unit.span, unit.path);
        if (unit.parent_id !== null) {
            const parent = units.get(unit.parent_id);
            if (!parent || parent.id === unit.id || parent.path !== unit.path || parent.span.start_byte > unit.span.start_byte ||
                parent.span.end_byte < unit.span.end_byte)
                throw new CMError("invalid_index", "Invalid unit parent");
            const seen = new Set([unit.id]);
            let ancestor = parent;
            while (ancestor.parent_id !== null) {
                if (seen.has(ancestor.id))
                    throw new CMError("invalid_index", "Unit parent cycle");
                seen.add(ancestor.id);
                const next = units.get(ancestor.parent_id);
                if (!next)
                    throw new CMError("invalid_index", "Missing ancestor");
                ancestor = next;
            }
        }
        if (unit.required_symbol_ids.some((id) => !symbols.has(id)))
            throw new CMError("invalid_index", "Unknown required symbol");
    }
    for (const symbol of index.symbols) {
        checkSpan(symbol.span, symbol.path);
        checkSpan(symbol.declaration_span, symbol.path);
        if (!units.has(symbol.owner_unit_id))
            throw new CMError("invalid_index", "Unknown symbol owner");
    }
    for (const relation of index.relations) {
        if (![relation.from_id, relation.to_id].every((id) => units.has(id) || symbols.has(id)))
            throw new CMError("invalid_index", "Dangling graph edge");
        checkSpan(relation.evidence);
    }
    return index;
}
// Validation is a pure function of the index bytes and of this code. A marker beside the index records the digest of bytes that
// passed it, so later processes skip re-validating identical bytes; any byte or validator change validates again.
const VALIDATOR = hash(JSON.stringify(schema) + "\n" + validateIndex.toString());
export class CMStore {
    projectRoot;
    indexPath;
    cached;
    constructor(projectRoot, indexPath) {
        this.projectRoot = resolve(projectRoot);
        this.indexPath = resolve(indexPath);
    }
    async load(signal, expectedSnapshot) {
        signal.throwIfAborted();
        let bytes;
        try {
            bytes = (await stat(this.indexPath)).size;
        }
        catch {
            throw new CMError("index_not_ready", "Build the local CM index with cm-index before using the plugin");
        }
        if (bytes > MAX_INDEX_BYTES)
            throw new CMError("index_limit", "Index exceeds 128 MiB");
        const raw = await readFile(this.indexPath, { signal });
        if (raw.length > MAX_INDEX_BYTES)
            throw new CMError("index_limit", "Index exceeds 128 MiB");
        const digest = hash(raw);
        if (this.cached?.digest !== digest) {
            let parsed;
            try {
                parsed = JSON.parse(utf8(raw));
            }
            catch (error) {
                throw new CMError("invalid_index", String(error));
            }
            const marker = this.indexPath + ".verified.json";
            let verified = false;
            try {
                const known = JSON.parse(await readFile(marker, "utf8"));
                verified = known.format === "cm-verified-1" && known.digest === digest && known.validator === VALIDATOR;
            }
            catch { /* No marker: validate. */ }
            const validated = verified ? parsed : validateIndex(parsed);
            if (!verified) {
                const temp = marker + "." + process.pid + ".tmp";
                try {
                    await writeFile(temp, JSON.stringify({ format: "cm-verified-1", digest, validator: VALIDATOR }));
                    await rename(temp, marker);
                }
                catch { /* A read-only index stays usable; it is validated each time. */ }
            }
            const pending = [validated];
            while (pending.length) {
                const current = pending.pop();
                for (const value of Object.values(current))
                    if (value !== null && typeof value === "object")
                        pending.push(value);
                Object.freeze(current);
            }
            this.cached = { digest, index: validated };
        }
        const index = this.cached.index;
        if (expectedSnapshot && expectedSnapshot !== index.snapshot_id)
            throw new CMError("snapshot_mismatch", "Re-run search against the current CM snapshot");
        const root = await realpath(this.projectRoot);
        for (const input of index.analysis_inputs) {
            signal.throwIfAborted();
            let path;
            try {
                path = await realpath(resolve(root, input.path));
            }
            catch {
                throw new CMError("index_outdated", `Analysis input removed: ${input.path}`);
            }
            if (!inside(root, path) || hash(await readFile(path, { signal })) !== input.sha256) {
                throw new CMError("index_outdated", `Analysis input changed: ${input.path}; rebuild CM`);
            }
        }
        for (const file of index.files) {
            signal.throwIfAborted();
            let sourcePath;
            try {
                sourcePath = await realpath(resolve(root, file.path));
            }
            catch {
                throw new CMError("index_outdated", `Source removed: ${file.path}`);
            }
            if (!inside(root, sourcePath))
                throw new CMError("source_outside_project", file.path);
            if (hash(await readFile(sourcePath, { signal })) !== file.sha256)
                throw new CMError("index_outdated", `Source changed: ${file.path}; rebuild CM`);
        }
        signal.throwIfAborted();
        return index;
    }
}
