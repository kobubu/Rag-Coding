import { bounded } from "./query.js";
import { CMError } from "./source.js";
import { LocalVectors, sourceSlice, words } from "./vector.js";
import type { CMIndex, CMUnit, SourceSpan } from "./types.js";

type ContextPart = { path: string; span: SourceSpan; text: string; reason: "match" | "dependency" };
export type RetrievedContext = { snapshot_id: string; channels: string[]; bytes_used: number; parts: ContextPart[]; omissions: number; complete: false };
const STOP = new Set(words("a an the of to in for from with and or is are be should must when then this that fix bug regression ensure preserve behavior existing code apply use please task change project"));
function terms(text: string): string[] {
  return words(text).map((word) => word.length > 8 && /ence$/.test(word) ? word.slice(0, -4) :
    word.length > 6 && /ing$/.test(word) ? word.slice(0, -3) : word.length > 5 && /ed$/.test(word) ? word.slice(0, -2) :
    word.length > 4 && /s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word);
}

export async function retrieveContext(index: CMIndex, vectors: LocalVectors, query: string, maxBytes = 6000, signal?: AbortSignal): Promise<RetrievedContext> {
  if (!query.trim() || query.length > 16000) throw new CMError("invalid_argument", "query must contain 1..16000 characters");
  const budget = bounded(maxBytes, 6000, 32000, "max_bytes");
  const queryWords = [...new Set(terms(query).filter((word) => word.length > 1 && !STOP.has(word)))];
  const unitById = new Map(index.units.map((unit) => [unit.id, unit]));
  const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
  const candidates = index.units.filter((unit) => unit.kind !== "file" && unit.kind !== "block");
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
  for (const unit of candidates) if (explicitNames.has(unit.name)) combined.set(unit.id, (combined.get(unit.id) ?? 0) + 1);
  const ordered = [...combined].sort((a, b) => b[1] - a[1]);
  const selected: CMUnit[] = ordered.filter(([, score]) => score >= (ordered[0]?.[1] ?? 0) * 0.85).slice(0, 2).map(([id]) => unitById.get(id)!);
  const parts: ContextPart[] = [];
  let bytes = 0, omissions = 0;
  const add = (path: string, span: SourceSpan, reason: ContextPart["reason"]) => {
    if (parts.some((part) => part.path === path && part.span.start_byte <= span.start_byte && part.span.end_byte >= span.end_byte)) return;
    if (parts.some((part) => part.path === path && span.start_byte <= part.span.start_byte && span.end_byte >= part.span.end_byte)) { omissions++; return; }
    const length = span.end_byte - span.start_byte;
    if (bytes + length > budget) { omissions++; return; }
    const file = index.files.find((item) => item.path === path)!;
    const text = Buffer.from(file.source, "utf8").subarray(span.start_byte, span.end_byte).toString("utf8");
    parts.push({ path, span, text, reason }); bytes += length;
  };
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
  return "CM context (partial; source version checked):\n" + context.parts.map((part) => `${part.path}:${part.span.line_start}-${part.span.line_end}\n${part.text}`).join("\n\n") +
    `\n${context.omissions} additional spans omitted. Request more context or read if necessary.`;
}
