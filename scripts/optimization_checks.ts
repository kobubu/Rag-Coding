import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { hash } from "../src/code-memory/source.js";

export const OPTIMIZATION_TARGETS = {
  horizontal: { path: "game/fil/src/renderVisibilityModel.js", exported: "createHorizontalRenderIndex" },
  union: { path: "game/fil/src/platformVisualModel.js", exported: "rectangleUnionCells" },
} as const;
export type OptimizationTask = keyof typeof OPTIMIZATION_TARGETS;
type Rect = { x: number; y: number; w: number; h: number; id?: string; [key: string]: unknown };
type Level = { number: number; platforms: Rect[]; hazards: Rect[]; movers?: Rect[]; rotors?: Rect[] };
type Horizontal = (items: Rect[], bounds?: (item: Rect) => { x: number; w: number }) => (left: number, right: number) => Rect[];
type Union = (items: Rect[]) => { x: number; y: number; w: number; h: number }[];
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >>> 1]!;
function random(seed: number) { let value = seed; return () => ((value = Math.imul(value, 1664525) + 1013904223 | 0) >>> 0) / 4294967296; }
function rectangles(seed: number, count: number): Rect[] {
  const next = random(seed);
  return Array.from({ length: count }, (_, i) => ({ id: `item-${i}`, x: Math.floor(next() * 3000) - 1000, y: Math.floor(next() * 600), w: Math.floor(next() * 180), h: Math.floor(next() * 180) }));
}
function pairedTiming(before: () => number, after: () => number, smoke: boolean) {
  const samples: { before_ms: number; after_ms: number; checksum_before: number; checksum_after: number }[] = [];
  for (let i = 0; i < (smoke ? 1 : 3); i++) { before(); after(); }
  for (let i = 0; i < (smoke ? 3 : 9); i++) {
    const run = (fn: () => number) => { const start = performance.now(); const checksum = fn(); return { ms: performance.now() - start, checksum }; };
    const order = i % 2 ? [after, before, before, after] : [before, after, after, before];
    const observed = order.map(fn => ({ fn, ...run(fn) }));
    const a = observed.filter(item => item.fn === before), b = observed.filter(item => item.fn === after);
    assert(observed.every(item => item.checksum === observed[0]!.checksum), "Timed workload result changed");
    samples.push({ before_ms: (a[0]!.ms + a[1]!.ms) / 2, after_ms: (b[0]!.ms + b[1]!.ms) / 2,
      checksum_before: a[0]!.checksum, checksum_after: b[0]!.checksum });
  }
  const before_ms = median(samples.map(item => item.before_ms)), after_ms = median(samples.map(item => item.after_ms));
  return { before_ms, after_ms, speedup: before_ms / after_ms, paired_wins: samples.filter(item => item.after_ms < item.before_ms).length, samples };
}

export async function checkOptimization(workspace: string, baseline: string, task: OptimizationTask, smoke = false) {
  const target = OPTIMIZATION_TARGETS[task]; if (!target) throw new Error("Unknown optimization task");
  const moduleURL = (root: string) => pathToFileURL(join(root, target.path)).href + "?cm_content=" + hash(readFileSync(join(root, target.path)));
  const [beforeModule, afterModule, content] = await Promise.all([
    import(moduleURL(baseline)), import(moduleURL(workspace)),
    import(pathToFileURL(join(baseline, "game/fil/src/levels.js")).href),
  ]) as [Record<string, unknown>, Record<string, unknown>, { levels: Level[] }];
  const levels = smoke ? content.levels.slice(0, 3) : content.levels;
  const failures: { check: string; error: string }[] = []; let passed = 0, total = 0;
  const check = (name: string, fn: () => void) => { total++; try { fn(); passed++; } catch (error) { failures.push({ check: name, error: String(error).slice(0, 500) }); } };
  const seed = smoke ? 761 : 21763;
  const changed = hash(readFileSync(join(workspace, target.path))) !== hash(readFileSync(join(baseline, target.path)));
  if (task === "horizontal") {
    const before = beforeModule[target.exported] as Horizontal, after = afterModule[target.exported] as Horizontal;
    for (let n = 0; n < (smoke ? 4 : 100); n++) check(`range-fuzz-${n}`, () => {
      const items = rectangles(seed + n, n % 4 === 0 ? 0 : 25 + n);
      if (items.length) items.push(items[0]!);
      const bounds = (item: Rect) => ({ x: item.x - 12, w: item.w + 24 });
      const a = before(items, bounds), b = after(items, bounds), next = random(seed + n + 100);
      for (let q = 0; q < 60; q++) {
        const left = Math.floor(next() * 4500) - 1500, right = left + (q % 3 ? 844 : 34);
        const expected = a(left, right), actual = b(left, right);
        assert.equal(actual.length, expected.length);
        for (let i = 0; i < expected.length; i++) assert.equal(actual[i], expected[i]);
      }
    });
    check("strict-boundaries-order-duplicates-and-fresh-arrays", () => {
      const item = { x: 0, y: 0, w: 50, h: 10 }, items = [item, { x: 20, y: 0, w: 0, h: 10 }, item];
      const a = before(items), b = after(items);
      for (const [left, right] of [[-100, 0], [50, 100], [0, 50], [-1, 51], [30, 20], [-Infinity, Infinity]]) assert.deepEqual(b(left!, right!), a(left!, right!));
      const result = b(-1, 51); result.length = 0;
      assert.deepEqual(b(-1, 51), a(-1, 51));
    });
    check("bounds-once-and-live-identity-with-snapshotted-geometry", () => {
      const items = rectangles(29, 8); let calls = 0;
      const a = before(items), b = after(items, item => { calls++; return item; });
      assert.equal(calls, items.length);
      for (const item of items) { item.x += 10000; item.collected = true; }
      assert.deepEqual(b(-1000, 3000), a(-1000, 3000)); assert.equal(calls, items.length);
    });
    check("unrelated-raster-exports-retained", () => {
      assert.deepEqual(Object.keys(afterModule).sort(), Object.keys(beforeModule).sort());
      if (typeof beforeModule.createRasterCache === "function") {
        type Raster = { setScale: (value: number) => void; snapshot: () => unknown };
        const a = (beforeModule.createRasterCache as (...args: number[]) => Raster)(4096, 1024);
        const b = (afterModule.createRasterCache as (...args: number[]) => Raster)(4096, 1024);
        a.setScale(1.22); b.setScale(1.22); assert.deepEqual(b.snapshot(), a.snapshot());
      }
    });
    if (failures.length) return result();
    const workloads = levels.flatMap(level => ["platforms", "hazards", "movers", "rotors"].map(kind => {
      const items = level[kind as keyof Level] as Rect[] ?? [];
      const max = Math.max(1000, ...items.map(item => item.x + (item.w || 0)));
      const bounds = (item: Rect) => {
        const reach = kind === "movers" && item.axis === "x" ? Math.abs(Number(item.amp) || 0) : kind === "rotors" ? Math.hypot(Number(item.length ?? 168), Number(item.thickness ?? 24)) / 2 : 0;
        return kind === "rotors" ? { x: item.x - reach, w: reach * 2 } : { x: item.x - reach, w: (item.w || 0) + reach * 2 };
      };
      const a = before(items, bounds), b = after(items, bounds);
      const queries = Array.from({ length: 100 }, (_, n) => [max * n / 100 - 20, max * n / 100 + (n % 2 ? 844 : 34)]);
      check(`actual-${level.number}-${kind}`, () => { for (const [left, right] of queries) assert.deepEqual(b(left!, right!), a(left!, right!)); });
      return { a, b, queries, items, bounds };
    }));
    const run = (candidate: boolean) => { let checksum = 0; for (let r = 0; r < (smoke ? 2 : 24); r++) for (const workload of workloads) for (const [left, right] of workload.queries) checksum += (candidate ? workload.b : workload.a)(left!, right!).length; return checksum; };
    const real = pairedTiming(() => run(false), () => run(true), smoke);
    const dense = [{ x: -10000, y: 0, w: 120000, h: 10 }, ...Array.from({ length: 8000 }, (_, n) => ({ x: n * 10, y: 0, w: 5, h: 10 }))];
    const stressBefore = before(dense), stressAfter = after(dense);
    check("long-span-stress-preserves-original-order", () => { for (let x = 0; x < 80000; x += 719) assert.deepEqual(stressAfter(x, x + 34), stressBefore(x, x + 34)); });
    const stressRun = (fn: ReturnType<Horizontal>) => { let result = 0; for (let r = 0; r < (smoke ? 1 : 3); r++) for (let x = 0; x < 80000; x += 131) result += fn(x, x + 34).length; return result; };
    const stress = pairedTiming(() => stressRun(stressBefore), () => stressRun(stressAfter), smoke);
    const construction = pairedTiming(() => { let n = 0; for (let r = 0; r < 8; r++) for (const w of workloads) n += before(w.items, w.bounds)(0, 844).length; return n; },
      () => { let n = 0; for (let r = 0; r < 8; r++) for (const w of workloads) n += after(w.items, w.bounds)(0, 844).length; return n; }, smoke);
    return result({ real, stress, construction, contract: "Exact order/identity, duplicate entries, strict overlap, snapshotted bounds, fresh query arrays" });
  }
  const before = beforeModule[target.exported] as Union, after = afterModule[target.exported] as Union;
  for (let n = 0; n < (smoke ? 4 : 90); n++) check(`union-fuzz-${n}`, () => {
    const items = rectangles(seed + n, n % 5 === 0 ? 0 : 10 + n);
    const original = structuredClone(items), expected = before(items), actual = after(items);
    assert.deepEqual(actual, expected); assert.deepEqual(items, original);
  });
  check("holes-touching-duplicates-and-epsilon", () => {
    const cases = [[{x:0,y:0,w:10,h:10},{x:10,y:0,w:10,h:10}],
      [{x:0,y:0,w:30,h:5},{x:0,y:15,w:30,h:5},{x:0,y:0,w:5,h:20},{x:25,y:0,w:5,h:20}],
      [{x:0,y:0,w:10,h:10},{x:0,y:10+.5e-6,w:10,h:10},{x:0,y:0,w:10,h:10}],
      [{x:0,y:0,w:0,h:5},{x:-20,y:-30,w:20,h:30}]];
    for (const items of cases) assert.deepEqual(after(items), before(items));
  });
  check("mutable-input-and-independent-returned-cells", () => {
    const items = rectangles(9, 20), first = after(items); first[0]!.w = 999999;
    assert.deepEqual(after(items), before(items)); items[0]!.x += 20; items[1]!.h += 40;
    assert.deepEqual(after(items), before(items));
  });
  for (const level of levels) {
    check(`actual-platform-cells-${level.number}`, () => assert.deepEqual(after(level.platforms), before(level.platforms)));
    for (const name of ["buildPlatformVisualPlan", "exposedRectangleEdges", "platformSupportRims"]) check(`actual-caller-${name}-${level.number}`, () => {
      const a = beforeModule[name] as (items: Rect[]) => unknown, b = afterModule[name] as (items: Rect[]) => unknown;
      assert.deepEqual(b(level.platforms), a(level.platforms));
    });
  }
  for (const name of ["buildPlatformVisualPlan", "exposedRectangleEdges", "platformSupportRims"])
    check(`other-export-${name}`, () => {
      const a = beforeModule[name] as (items: Rect[]) => unknown, b = afterModule[name] as (items: Rect[]) => unknown;
      assert.equal(typeof b, "function");
      const items = rectangles(12, 15); assert.deepEqual(b(items), a(items));
    });
  if (failures.length) return result();
  const runUnion = (fn: Union, items: Rect[][], repeats: number) => { let checksum = 0; for (let r = 0; r < repeats; r++) for (const input of items) {
    const fresh = input.map(item => ({ ...item })); const cells = fn(fresh); checksum += cells.length;
    for (const cell of cells) checksum += cell.w + cell.h;
  } return checksum; };
  const real = pairedTiming(() => runUnion(before, levels.map(level => level.platforms), smoke ? 1 : 5), () => runUnion(after, levels.map(level => level.platforms), smoke ? 1 : 5), smoke);
  const stressInputs = [rectangles(217, smoke ? 120 : 500), Array.from({ length: smoke ? 120 : 600 }, (_, n) => ({ x: n * 12, y: n % 6 * 20, w: 10, h: 15 }))];
  check("dense-and-disjoint-stress-cells", () => { for (const items of stressInputs) assert.deepEqual(after(items), before(items)); });
  const stress = pairedTiming(() => runUnion(before, stressInputs, 1), () => runUnion(after, stressInputs, 1), smoke);
  return result({ real, stress, contract: "Exact cells/order/merging/epsilon; no input mutation; fresh output; other exported callers unchanged" });

  function result(metrics?: { real: ReturnType<typeof pairedTiming>; stress: ReturnType<typeof pairedTiming>; construction?: ReturnType<typeof pairedTiming>; contract: string }) {
    const behavior_pass = failures.length === 0;
    const optimization_pass = changed && behavior_pass && !!metrics && metrics.real.after_ms <= .85 * metrics.real.before_ms && metrics.real.paired_wins >= (smoke ? 2 : 7) && metrics.stress.speedup >= .9 && (!metrics.construction || metrics.construction.speedup >= .25);
    return { mode: smoke ? "public-smoke" : "independent-final", task, behavior: { pass: behavior_pass, passed, total, failures: failures.slice(0, 10) },
      performance: metrics, changed, optimization_pass, pass: behavior_pass, target_sha256: hash(readFileSync(join(workspace, target.path))),
      limitation: "CPU of the target on actual project geometry plus separate stress; not whole-game FPS or phone evidence" };
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const data = await checkOptimization(resolve(process.argv[2]!), resolve(process.argv[3]!), process.argv[4] as OptimizationTask, process.argv.includes("--public"));
    console.log(JSON.stringify(data)); process.exitCode = data.behavior.pass ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ pass: false, behavior: { pass: false }, error: String(error) })); process.exitCode = 1; }
}
