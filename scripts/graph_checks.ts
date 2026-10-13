import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash } from "../src/code-memory/source.js";

export async function checkGraphRepair(workspace: string, task: string, publicSmoke = false) {
  let checks = 0;
  const check = (condition: unknown, description: string) => { checks++; assert(condition, description); };
  const load = async (path: string) => {
    const file = resolve(workspace, path);
    return await import(pathToFileURL(file).href + "?v=" + hash(readFileSync(file))) as Record<string, (...args: any[]) => any>;
  };
  if (task === "named-percentile" || task === "discover-statistics-tie") {
    const stats = await load("game/src/metrics/statistics.js");
    const samples = [[], [7], [9, -4, 2, 13], [0, 0, 0], [9, 2, 5, 1, 22]];
    for (const values of samples) for (const ratio of [0, .25, .5, .75, 1]) {
      const before = JSON.stringify(values);
      const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * ratio;
      const expected = !sorted.length ? 0 : sorted[Math.floor(position)]! * (1 - (position % 1)) + sorted[Math.ceil(position)]! * (position % 1);
      check(Math.abs(stats.percentile!(values, ratio) - expected) < 1e-10, "Numeric percentile/interpolation");
      check(JSON.stringify(values) === before, "Input remains stable");
    }
    const sequences = [[], ["a"], ["a", "a", "b", "b"], ["a", "b", "b", "b", "a"], ["a", "a", "a", "b", "b"]];
    let seed = publicSmoke ? 71 : 1847;
    for (let n = 0; n < (publicSmoke ? 5 : 80); n++) {
      const sequence: string[] = [];
      for (let i = 0; i < n % 23; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; sequence.push(String(seed % 3)); }
      sequences.push(sequence);
    }
    for (const sequence of sequences) {
      const ranges: { value: string; length: number; startIndex: number; endIndex: number }[] = [];
      for (let i = 0; i < sequence.length; i++) {
        if (i && sequence[i] === sequence[i - 1]) continue;
        let end = i; while (end + 1 < sequence.length && sequence[end + 1] === sequence[i]) end++;
        ranges.push({ value: sequence[i]!, length: end - i + 1, startIndex: i, endIndex: end });
      }
      const expected = ranges.sort((a, b) => b.length - a.length || a.startIndex - b.startIndex)[0] ?? { value: null, length: 0, startIndex: -1, endIndex: -1 };
      check(JSON.stringify(stats.maxRunDetail!(sequence)) === JSON.stringify(expected), "Longest run indices and first tie");
      const full = stats.sequenceStats!(sequence);check(JSON.stringify(full.longestRun) === JSON.stringify(expected), "Producer preserves helper result");
      check(Number.isFinite(full.entropy) && full.entropy >= 0 && full.entropy <= 1 + 1e-12, "Entropy range");
      check(full.dominant.share === (sequence.length ? full.dominant.count / sequence.length : 0), "Dominant share");
    }
  } else if (task === "named-raster-lru") {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) } });
    try {
      const module = await load("game/fil/geo-static-cache.js");
      const cache = module.createRasterCache!(32);let paints = 0;const paint = () => paints++;
      const a = cache.get("a", 2, 2, paint), b = cache.get("b", 2, 2, paint);
      check(cache.get("a", 2, 2, paint) === a, "Hit retains identity");cache.get("c", 2, 2, paint);
      check(b.width === 0 && b.height === 0 && a.width === 2, "Evict oldest unused backing store");
      check(cache.get("a", 2, 2, paint) === a && paints === 3, "Promotion avoids rebuild");
      const state = cache.snapshot();check(state.bytes === 32 && state.entries === 2 && state.builds === 3 && state.hits === 2 && state.evictions === 1, "LRU accounting");
      check(cache.get("huge", 99, 99, paint) === null && paints === 3, "Budget bypass");
      check(cache.get("zero", 0, 2, paint) === null, "Invalid dimensions");
      cache.setScale(1.13);check(cache.scale() === 1.25, "Quarter-scale rounding");cache.setScale(5);check(cache.scale() === 2, "Scale ceiling");
      const capped = module.createRasterCache!(64, 8);check(capped.get("entry", 2, 2, paint) === null, "Entry cap");
    } finally { if (descriptor) Object.defineProperty(globalThis, "document", descriptor);else Reflect.deleteProperty(globalThis, "document"); }
  } else if (task === "discover-input-depth") {
    const module = await load("game/src/metrics/input-consequence.js");
    for (const target of [1, 2, -1, .5]) {
      const noInput = { ok: true, coins: ["b", "a"], depthChanges: [{ id: "portal", to: 0 }] };
      const tap = { ...noInput, depthChanges: [{ id: "portal", to: target }], inputCounterfactual: { launched: true } };
      const result = module.compareInputCounterfactuals!(noInput, tap);
      check(result.distinctOutcome && result.consequential && !result.neutral, "Changed destination is consequential");
      check(module.inputOutcomeSignature!(noInput) !== module.inputOutcomeSignature!(tap), "Depth destination in signature");
      check(!module.compareInputCounterfactuals!(noInput, { ...tap, inputCounterfactual: { launched: false } }).consequential, "Unlaunched tap");
    }
    const a = { ok: true, coins: ["a", "b"], events: [{ type: "orb", id: "a" }, { type: "orb", id: "b" }] };
    const b = { ...a, coins: ["b", "a"], events: [...a.events].reverse(), inputCounterfactual: { launched: true } };
    check(module.inputOutcomeSignature!(a) === module.inputOutcomeSignature!(b), "Contact order is irrelevant");
    check(module.compareInputCounterfactuals!(a, b).neutral, "Equal launched outcome is neutral");
  } else if (task === "discover-mobile-image") {
    const resolver = await load("game/src/render/image-source.js"), data = await load("game/src/content/mobile-images.js");
    const imageRoot = pathToFileURL(resolve(workspace, "game") + "/").href;
    const rows = Object.entries(data.mobileImageVariants!);
    check(rows.length > 0, "Real mobile manifest");
    for (const [source, target] of rows.slice(0, publicSmoke ? 3 : rows.length)) {
      check(resolver.runtimeImageSource!(new URL(source, imageRoot).href) === new URL(String(target), imageRoot).href, "Configured variant selected");
    }
    for (const source of ["https://external.example/art.png", new URL("unmapped.png", imageRoot).href]) check(resolver.runtimeImageSource!(source) === source, "External/unmapped source preserved");
  } else if (task === "locale-two-modules") {
    const descriptors = new Map(["location", "navigator", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const values: Record<string, unknown> = { location: { search: "?locale=ar" }, navigator: { language: "de" }, localStorage: { getItem: () => JSON.stringify({ locale: "fr" }), setItem: () => {} } };
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
    try {
      const strings = await load("game/src/localization/strings.js"), page = await load("game/fil/geo-localization.js");
      for (const locale of ["zh-TW", "zh-HK", "zh-Hant-TW"]) check(strings.resolveLocale!(locale) === "zh-Hant", "Traditional Chinese aliases");
      for (const [input, expected] of [["pt-PT", "pt-BR"], ["no", "nb-NO"], ["de-DE", "de"], ["unknown", "en"], [undefined, "en"], ["zh-CN", "zh-Hans"]]) check(strings.resolveLocale!(input) === expected, "Other locale fallbacks");
      check(page.geoPageLocale!() === "ar", "Query outranks saved locale");
      const documentRoot = { documentElement: { lang: "", dir: "" }, querySelectorAll: () => [] };
      check(page.applyGeoDocumentLocale!("ar", documentRoot) === "ar" && documentRoot.documentElement.dir === "rtl", "Arabic direction");
      check(page.applyGeoDocumentLocale!("de", documentRoot) === "de" && documentRoot.documentElement.dir === "ltr", "Other direction");
    } finally { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor);else Reflect.deleteProperty(globalThis, key); }
  } else throw new Error("Unknown graph repair task");
  return { pass: true, checks, mode: publicSmoke ? "public-smoke" : "independent-final" };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await checkGraphRepair(resolve(process.argv[2]!), process.argv[4]!, process.argv.includes("--public")))); }
  catch (error) { console.log(JSON.stringify({ pass: false, error: String(error).slice(0, 1000) }));process.exitCode = 1; }
}
