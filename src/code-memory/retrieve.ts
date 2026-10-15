import { bounded } from "./query.js";
import { CMError } from "./source.js";
import { LocalVectors, sourceSlice, words } from "./vector.js";
import type { CMIndex, SourceSpan } from "./types.js";
import type { CMChunk } from "./chunks.js";
import { retrieveGraph } from "./graph_retrieve.js";
import type { RetrievalDetail, RetrievalPolicy } from "./graph_retrieve.js";

type ContextPart = { path: string; span: SourceSpan; text: string; reason: "match" | "dependency" | "signature"; whole?: true };
export type RetrievedContext = { snapshot_id: string; channels: string[]; bytes_used: number; parts: ContextPart[]; omissions: number; complete: false;
  retrieval?: { policy: RetrievalPolicy; route: "named" | "discovery"; detail: RetrievalDetail; roots: number; graph_nodes: number; bindings_shown: number; bindings_omitted: number; dense_search: boolean }; notes?: string[] };
const STOP = new Set(words("a an the of to in for from with and or is are be should must when then this that fix bug regression ensure preserve behavior existing code apply use please task change project"));
function terms(text: string): string[] {
  return words(text).map((word) => word.length > 8 && /ence$/.test(word) ? word.slice(0, -4) :
    word.length > 6 && /ing$/.test(word) ? word.slice(0, -3) : word.length > 5 && /ed$/.test(word) ? word.slice(0, -2) :
    word.length > 4 && /s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word);
}

export async function retrieveContext(index: CMIndex, vectors: LocalVectors, query: string, maxBytes = 6000, signal?: AbortSignal,
  strategy?: { policy: RetrievalPolicy; detail?: RetrievalDetail }): Promise<RetrievedContext> {
  if (strategy && !["hybrid", "graph", "adaptive"].includes(strategy.policy)) throw new CMError("invalid_argument", "Unknown retrieval policy");
  if (strategy && strategy.policy !== "hybrid") return retrieveGraph(index, vectors, query, maxBytes, signal, strategy.policy, strategy.detail ?? "focused");
  if (!query.trim() || query.length > 16000) throw new CMError("invalid_argument", "query must contain 1..16000 characters");
  const budget = bounded(maxBytes, 6000, 32000, "max_bytes");
  const queryWords = [...new Set(terms(query).filter((word) => word.length > 1 && !STOP.has(word)))];
  const chunks = vectors.chunks(index);
  const unitById = new Map(chunks.map((unit) => [unit.id, unit]));
  const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
  const candidates = chunks.filter((unit) => vectors.config.chunking && vectors.config.chunking !== "unit" || unit.kind !== "block");
  const vocabulary = new Map(candidates.map((unit) => [unit.id, new Set(terms(unit.name + " " + unit.path + " " + sourceSlice(index, unit)))]));
  const frequencies = new Map(queryWords.map((word) => [word, candidates.reduce((count, unit) => count + Number(vocabulary.get(unit.id)!.has(word)), 0)]));
  const ranked = candidates.map((unit) => {
    const nameWords = new Set(terms(unit.name));
    const score = queryWords.reduce((total, word) => total + (vocabulary.get(unit.id)!.has(word) ? Math.log(1 + candidates.length / (1 + frequencies.get(word)!)) * (nameWords.has(word) ? 3 : 1) : 0), 0);
    return { id: unit.id, score: score / Math.pow(Math.max(1, sourceSlice(index, unit).length / 1000), 0.2) };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  const dense = await vectors.search(index, query, 24, signal);
  const combined = new Map<string, number>();
  for (const [rank, item] of ranked.slice(0, 24).entries()) combined.set(item.id, 2 / (10 + rank));
  for (const [rank, item] of dense.entries()) combined.set(item.id, (combined.get(item.id) ?? 0) + 1 / (10 + rank));
  const explicitNames = new Set([...query.matchAll(/`([\w$]+)`/g)].map((match) => match[1]!));
  if (/^[\w$]+$/.test(query.trim())) explicitNames.add(query.trim());
  for (const unit of candidates) if (unit.symbol_names.some(name => explicitNames.has(name))) combined.set(unit.id, (combined.get(unit.id) ?? 0) + 1);
  const ordered = [...combined].sort((a, b) => b[1] - a[1]);
  const selected: CMChunk[] = ordered.filter(([, score]) => score >= (ordered[0]?.[1] ?? 0) * 0.85).slice(0, 2).map(([id]) => unitById.get(id)!);
  const parts: ContextPart[] = [];
  let bytes = 0, omissions = 0;
  const add = (path: string, span: SourceSpan, reason: ContextPart["reason"]) => {
    if (parts.some((part) => part.path === path && part.span.start_byte <= span.start_byte && part.span.end_byte >= span.end_byte)) return;
    if (reason === "dependency" && parts.some((part) => part.reason !== "signature" && part.path === path && span.start_byte <= part.span.start_byte && span.end_byte >= part.span.end_byte)) { omissions++; return; }
    const file = index.files.find((item) => item.path === path)!;
    const raw = Buffer.from(file.source, "utf8");
    let ranges = [[span.start_byte, span.end_byte]];
    for (const part of parts.filter(part => part.path === path)) ranges = ranges.flatMap(([start, end]) =>
      part.span.end_byte <= start! || part.span.start_byte >= end! ? [[start!, end!]] :
      [[start!, Math.min(end!, part.span.start_byte)], [Math.max(start!, part.span.end_byte), end!]].filter(([a, b]) => b! > a!));
    const length = ranges.reduce((total, [start, end]) => total + end! - start!, 0);
    if (bytes + length > budget) { omissions++; return; }
    for (const [start, end] of ranges) {
      const actualSpan = { ...span, start_byte: start!, end_byte: end!,
        line_start: raw.subarray(0, start!).toString("utf8").split("\n").length,
        line_end: raw.subarray(0, Math.max(start!, end! - 1)).toString("utf8").split("\n").length };
      parts.push({ path, span: actualSpan, text: raw.subarray(start!, end!).toString("utf8"), reason });
    }
    bytes += length;
  };
  for (const unit of selected) for (const signature of unit.signatures) add(unit.path, signature, "signature");
  for (const unit of selected) add(unit.path, unit.span, "match");
  for (const unit of selected) {
    for (const id of unit.required_symbol_ids) {
      const symbol = symbols.get(id)!;
      add(symbol.path, symbol.declaration_span, "dependency");
    }
  }
  signal?.throwIfAborted();
  return { snapshot_id: index.snapshot_id, channels: ["exact", "lexical-idf", "local-dense-vector", "required-symbols"], bytes_used: bytes, parts, omissions, complete: false };
}

export function renderContext(context: RetrievedContext): string {
  // Say exactly what is shown: a vague "partial, read if necessary" makes models re-read files they already have.
  return "CM context (current saved source, version checked and registered as read for edit):\n" + (context.retrieval ? `Route: ${context.retrieval.policy}/${context.retrieval.route}; bindings shown ${context.retrieval.bindings_shown}, omitted ${context.retrieval.bindings_omitted}.\n` : "") +
    context.parts.map((part) => `${part.path}:${part.span.line_start}-${part.span.line_end}${part.whole ? " (whole file)" : ""}\n${part.text}`).join("\n\n") +
    (context.notes?.length ? "\n" + context.notes.join("\n") : "") +
    (context.omissions ? `\n${context.omissions} additional spans omitted. Request more context or read if necessary.` : "\nNo resolved bindings of the shown definitions were omitted; other code is not shown.");
}
