import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { hash } from "../src/code-memory/source.js";

export async function checkClientTask(workspace: string, baseline: string, task: string) {
  let checks = 0, seed = 156731;
  const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  const load = async (root: string, path: string): Promise<any> => import(pathToFileURL(join(root, path)).href + "?v=" + hash(readFileSync(join(root, path))));
  const same = (actual: unknown, expected: unknown, why: string) => { checks++; assert.deepEqual(actual, expected, why); };
  const near = (a: number, b: number, why: string) => { checks++; assert(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), why); };
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const time = (fn: () => unknown) => { const start = performance.now(); fn(); return performance.now() - start; };
  const target: Record<string, string> = { "stats-linear": "game/src/metrics/statistics.js", "wallet-deduplicate": "game/src/core/reward-wallet.js", "quota-validation": "game/src/core/progression.js", "motion-extrema": "game/src/core/geometry.js", "own-city-grants": "game/src/core/economy-ledger.js", "compiled-input": "game/src/core/input.js" };
  const path = target[task]; if (!path) throw Error("Unknown client benchmark task");
  const next = await load(workspace, path), prior = await load(baseline, path);
  same(Object.keys(next).sort(), [...Object.keys(prior), ...(task === "compiled-input" ? ["compileAuthoredInput"] : [])].sort(), "Export contract");
  let cpu: unknown = null;
  if (task === "stats-linear") {
    const arrays: unknown[][] = [[], [NaN, NaN, 1], ["__proto__", "constructor", "__proto__"], [1, "1", 2, "2", 1], [null, false, true, null], ["2", "1", "2", "a", "b"]];
    for (let i = 0; i < 80; i++) arrays.push(Array.from({ length: i * 2 }, () => Math.floor(rnd() * 12).toString()));
    for (const values of arrays) {
      const before = structuredClone(values); same(next.sequenceStats(values), prior.sequenceStats(values), "Full statistics semantics"); same(values, before, "Input unchanged");
      for (const name of ["entropy", "maxRun", "maxRunDetail"]) same(next[name](values), prior[name](values), "Other export " + name);
      same(next.percentile(values.filter(v => typeof v === "number" && Number.isFinite(v)), .5), prior.percentile(values.filter(v => typeof v === "number" && Number.isFinite(v)), .5), "Percentile preserved");
    }
    const values = Array.from({ length: 6500 }, (_, i) => "label-" + i % 3000); next.sequenceStats(values); prior.sequenceStats(values);
    const a: number[] = [], b: number[] = [];
    for (let i = 0; i < 9; i++) { if (i % 2) { b.push(time(() => prior.sequenceStats(values))); a.push(time(() => next.sequenceStats(values))); } else { a.push(time(() => next.sequenceStats(values))); b.push(time(() => prior.sequenceStats(values))); } }
    const speedup = median(b) / median(a); cpu = { baseline_ms: median(b), candidate_ms: median(a), speedup, gate: 1.25 };
    checks++; assert(speedup >= 1.25, "Full sequenceStats CPU speedup below gate");
  } else if (task === "wallet-deduplicate") {
    const finite = (v: unknown) => Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0;
    const numeric: unknown[] = [0, -2, 1.9, "2", NaN, Infinity, -Infinity, "bad", 50];
    for (let i = 0; i < 100; i++) {
      const receipts: any = i % 9 === 0 ? "not-an-array" : Array.from({ length: i % 15 }, (_, j) => ["video10:a", "video10:b", "video20:c", "video10:", null, 7, "video10:d"][Math.floor(rnd() * 7)]);
      const wallet = { coins: numeric[i % numeric.length], videoRewards: numeric[(i + 4) % numeric.length] }, save = { rewardReceipts: receipts }, before = structuredClone({ wallet, save });
      const count = new Set((Array.isArray(receipts) ? receipts : []).filter((v: unknown) => typeof v === "string" && v.startsWith("video10:") && v.length > 8)).size;
      const applied = finite(wallet.videoRewards), expected = { coins: finite(wallet.coins) + Math.max(0, count - applied) * 10, videoRewards: Math.max(count, applied) };
      const actual = next.syncVideoRewardWallet(wallet, save); same(actual, expected, "Unique monotonic receipts"); same(next.syncVideoRewardWallet(actual, save), actual, "Second sync idempotent"); same({ wallet, save }, before, "No mutation");
    }
  } else if (task === "quota-validation") {
    const policy = await load(workspace, "game/src/core/reward-policy.js"), now = Date.UTC(2026, 9, 15, 12), today = "2026-10-15";
    const validDay = (day: unknown) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(+new Date(day + "T12:00:00Z")) && new Date(day + "T12:00:00Z").toISOString().slice(0, 10) === day;
    const counts = [undefined, NaN, Infinity, -2, 1.9, 4, "2", "bad", 0];
    for (let i = 0; i < 90; i++) {
      const day = [today, "2026-10-16", "2026-10-14", "2026-99-99", "bad"][i % 5]!, value = counts[i % counts.length], grants: any = { [today + "/ad/bogus"]: 20, [today + "/ad/0suffix"]: 20, [today + "/ad/00"]: 20, [today + "/ad/9"]: 20 };
      for (let slot = 0; slot < 3; slot++) grants[today + "/ad/" + slot] = (i + slot) % 2 ? 20 : 999;
      const save = { ...next.freshProgress(), rewardDay: { day, count: value }, grants }, before = structuredClone(save);
      const recorded = validDay(day) && day >= today && Number.isFinite(Number(value)) ? Math.max(0, Math.min(3, Math.floor(Number(value)))) : 0;
      const used = Math.max(recorded, Object.values(grants).filter((v, n) => Object.keys(grants)[n]!.match(/^2026-10-15\/ad\/[0-2]$/) && v === 20).length);
      same(policy.dailyRewardStatus(save, now), { day: validDay(day) && day > today ? day : today, used, remaining: 3 - used, limit: 3, coins: 20 }, "Normalized counter and genuine grant slots"); same(save, before, "Status immutable");
    }
    for (const amount of [20.5, 20.00001, NaN, Infinity, 19.9, -20]) { const save = next.freshProgress(), before = structuredClone(save); same(next.creditAdReward(save, "receipt:new", amount, now), false, "Exact amount"); same(save, before, "Rejected amount atomic"); }
    for (const receipt of [undefined, null, "", "x".repeat(100)]) { const save = next.freshProgress(), before = structuredClone(save); same(next.creditAdReward(save, receipt, 20, now), false, "Invalid receipt"); same(save, before, "Rejected receipt atomic"); }
    const save = next.freshProgress(); same(next.creditAdReward(save, "valid", "20", now), true, "Numeric string retained"); const before = structuredClone(save); same(next.creditAdReward(save, "valid", 20, now), false, "Duplicate"); same(save, before, "Duplicate atomic");
  } else if (task === "motion-extrema") {
    for (let i = 0; i < 160; i++) {
      const object: any = { x: rnd() * 20, y: rnd() * 20, w: 3 + rnd() * 30, h: 5 + rnd() * 30, ...(i % 3 ? {} : { shape: "circle", r: 1 + rnd() * 9 }), ...(i % 13 ? { motion: { dx: (rnd() - .5) * 80, dy: (rnd() - .5) * 80, period: .05 + rnd() * 4, phase: rnd() * 3 - 1 } } : {}) };
      const from = rnd() * 7 - 2, to = rnd() * 7 - 2, a = Math.min(from, to), b = Math.max(from, to), before = structuredClone(object);
      const times = [a, b]; if (object.motion) { const { period, phase } = object.motion; for (let k = Math.floor((a - phase) / period * 4) - 1; k <= Math.ceil((b - phase) / period * 4) + 1; k++) { const t = phase + k * period / 4; if (t >= a && t <= b) times.push(t); } }
      const poses = times.map(t => prior.hazardBounds(object, t)), x = Math.min(...poses.map(p => p.x)), y = Math.min(...poses.map(p => p.y)), expected = { x, y, w: Math.max(...poses.map(p => p.x + p.w)) - x, h: Math.max(...poses.map(p => p.y + p.h)) - y };
      const actual = next.sweptHazardBounds(object, from, to); for (const key of ["x", "y", "w", "h"]) near(actual[key], expected[key as keyof typeof expected], "Tight complete sine sweep " + key);
      same(object, before, "Motion input unchanged"); same(next.poseAt(object, from), prior.poseAt(object, from), "Unrelated pose helper");
    }
  } else if (task === "own-city-grants") {
    const { cityById } = await load(baseline, "game/src/content/cities.js"), cities = Object.keys(cityById);
    for (const city of [...cities, "toString", "constructor", "__proto__", "hasOwnProperty", "unknown-city"]) {
      const good = Object.hasOwn(cityById, city), run = "case_run_123", save: any = { grants: {}, recordBonuses: {} }, before = structuredClone(save);
      same(next.claimCompletion(save, city, run, 12), good ? { completion: 20, bonus: 12 } : { completion: 0, bonus: 0 }, "Only real configured own cities");
      if (!good) same(save, before, "Invalid claim immutable");
      same(next.normalizeGrants({ ["finish/" + city + "/" + run]: 20 }), good ? { ["finish/" + city + "/" + run]: 20 } : {}, "Grant normalizer cities");
      same(next.normalizeBonuses({ [city + "/" + run]: 12 }), good ? { [city + "/" + run]: 12 } : {}, "Bonus normalizer cities");
    }
    same(next.normalizeGrants({ "2026-10-15/login": 20, "2026-10-15/ad/0": 20, "2026-10-15/ad/3": 20 }), { "2026-10-15/login": 20, "2026-10-15/ad/0": 20 }, "Other ledger contracts");
  } else {
    for (const variant of ["perfect", "early", "late"]) for (let i = 0; i < 22; i++) {
      const level = { spawn: { x: -20 }, speed: 200, actions: Array.from({ length: 15 }, () => ({ x: rnd() * 400, hold: (rnd() - .15) * .7 })) }, before = structuredClone(level);
      const compiled = next.compileAuthoredInput(level, variant); same(level, before, "Compilation immutable");
      const boundaries = level.actions.flatMap(a => { const t = (a.x - level.spawn.x) / level.speed + prior.variants[variant]; return [t, t + a.hold, t - 1e-9, t + a.hold - 1e-9]; });
      for (const t of [...boundaries, ...Array.from({ length: 30 }, () => rnd() * 4 - 1)].reverse()) same(compiled(t), prior.authoredInput(before, t, variant), "Half-open union and arbitrary seek");
      level.actions.splice(0); for (const t of boundaries) same(compiled(t), prior.authoredInput(before, t, variant), "Compiled snapshot isolated from later edit");
    }
    for (const variant of ["bad", "toString", "__proto__"]) { checks++; assert.throws(() => next.compileAuthoredInput({ spawn: { x: 0 }, speed: 1, actions: [] }, variant), "Invalid variant"); }
    const level = { spawn: { x: 0 }, speed: 100, actions: Array.from({ length: 4000 }, (_, i) => ({ x: i * 40, hold: .03 })) }, constructionStart = performance.now(), compiled = next.compileAuthoredInput(level), constructionMs = performance.now() - constructionStart;
    let sink = 0; const query = (fn: (t: number) => boolean) => { for (let i = 0; i < 15000; i++) sink += Number(fn((i * 733 % 160000) / 100)); };
    query(compiled); query(t => prior.authoredInput(level, t)); const a: number[] = [], b: number[] = [];
    for (let i = 0; i < 7; i++) { if (i % 2) { b.push(time(() => query(t => prior.authoredInput(level, t)))); a.push(time(() => query(compiled))); } else { a.push(time(() => query(compiled))); b.push(time(() => query(t => prior.authoredInput(level, t)))); } }
    const speedup = median(b) / median(a); cpu = { baseline_ms: median(b), candidate_ms: median(a), construction_ms: constructionMs, speedup, gate: 1.25, sink };
    checks++; assert(speedup >= 1.25, "Compiled input query CPU speedup below gate");
  }
  return { pass: true, checks, cpu };
}
if (process.argv[1]?.endsWith("client_checks.js")) {
  try { console.log(JSON.stringify(await checkClientTask(resolve(process.argv[2]!), resolve(process.argv[3]!), process.argv[4]!))); }
  catch (error) { console.log(JSON.stringify({ pass: false, error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
}
