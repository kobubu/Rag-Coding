import assert from "node:assert/strict";
import { SEMVER } from "./semver_checks.js";
import { SUPERSTRUCT } from "./superstruct_checks.js";

// Holdout tasks: a second set of seeded bugs in other Geo Dash modules, written after CM was tuned on the six speed tasks.
// Each check compares the repaired module with the original one on fixed and seeded random inputs (differential testing).
type Module = Record<string, any>;
type Same = (actual: unknown, expected: unknown, name: string) => void;
type Load = (path: string) => Promise<Module>;
// feature: the original code lacks the requested behavior, so a baseline self-check verifies only that the grader runs.
// surface: false when the task changes the export surface itself (a rename).
export type HoldoutCheck = Check;
type Check = { path: string; feature?: true; surface?: false; run: (actual: Module, original: Module, same: Same, rnd: () => number, count: number, load: Load, loadActual: Load, workspace: string, baseline: string) => Promise<void> | void };
const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value), setItem() {} });
const validLimit = (value: unknown) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10;

const pick = <T>(rnd: () => number, items: T[]) => items[Math.floor(rnd() * items.length)]!;
export const HOLDOUT: Record<string, Check> = {
  "viewport-flip": { path: "game/fil/src/renderViewportModel.js", run(actual, original, same, rnd, count) {
    same(actual.verticallyVisible({ y: -500, h: 10 }, { top: 0, bottom: 600 }, { scale: -1, y: 0 }), true, "Flipped object inside the margin");
    for (let i = 0; i < count; i++) {
      const scale = pick(rnd, [-1.4, -0.62, -0.3, 0.62, 1, 1.4]) * (0.5 + rnd()), projection = { scale, y: rnd() * 400 - 200 };
      const bounds = { left: 0, right: 800, top: rnd() * 200 - 100, bottom: 300 + rnd() * 300 }, rect = { y: rnd() * 1600 - 800, h: rnd() * 120 };
      for (const margin of [undefined, 0, 60, 180]) same(actual.verticallyVisible(rect, bounds, projection, margin), original.verticallyVisible(rect, bounds, projection, margin), "Margin uses the scale magnitude");
      same(actual.verticallyVisible({ y: NaN, h: 3 }, bounds, projection), true, "Non-finite fallback");
      const matrix = { a: rnd() * 2 - 1, b: rnd() - 0.5, c: rnd() - 0.5, d: rnd() * 2 - 1, e: rnd() * 50, f: rnd() * 50 };
      same(actual.worldViewportBounds(matrix, 800, 600), original.worldViewportBounds(matrix, 800, 600), "Unrelated inverse bounds");
    }
  } },
  "pace-zero": { path: "game/fil/src/geoPaceModel.js", run(actual, original, same, rnd, count) {
    for (const pace of [0, -0, -1, NaN, Infinity, undefined, 0.5, 1, 1.08, 3]) {
      const level = { realTimePaceMultiplier: pace, music: { playbackRate: 1.1 } };
      same(actual.simulationPace(level), original.simulationPace(level) || 1, "Zero pace falls back to 1");
      for (const t of [-2, 0, 1.5, 30]) {
        same(actual.simulationSeconds(level, t), Math.max(0, t) * (original.simulationPace(level) || 1), "Simulation seconds");
        same(actual.activeRealtimeSeconds(level, t), Math.max(0, t) / (original.simulationPace(level) || 1), "Finite active time");
        same(actual.musicElapsedSeconds(level, t), Math.max(0, t) / (original.simulationPace(level) || 1) * 1.1, "Finite music time");
      }
    }
    for (let i = 0; i < count; i++) {
      const levels = Array.from({ length: 6 }, (_, n) => ({ number: 1 + Math.floor(rnd() * 20), realTimePaceMultiplier: n % 2 ? 1 + rnd() : undefined, speedMultiplier: 1 + rnd() * 0.3, music: n % 3 ? { playbackRate: 1 } : undefined }));
      const copy = structuredClone(levels);actual.applyGeoCityPace(levels);original.applyGeoCityPace(copy);same(levels, copy, "City pace tuning unchanged");
    }
  } },
  "ledger-day": { path: "game/src/core/economy-ledger.js", run(actual, original, same, rnd, count) {
    for (const [day, valid] of [["2026-02-30", false], ["2026-13-01", false], ["2026-04-31", false], ["2025-02-29", false], ["2024-02-29", true], ["2026-10-14", true], ["2026-1-04", false], ["x", false]] as const) same(actual.validDay(day), valid, "Real calendar day: " + day);
    for (let i = 0; i < count; i++) {
      const day = `20${20 + Math.floor(rnd() * 10)}-${String(1 + Math.floor(rnd() * 13)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 31)).padStart(2, "0")}`;
      same(actual.validDay(day), original.validDay(day), "Calendar validation");
      const grants = { [day + "/login"]: 20, [day + "/ad/" + (i % 4)]: 20, ["finish/tokyo/run-" + "a".repeat(8)]: 20, [day + "/login-x"]: 20 };
      same(actual.normalizeGrants(grants), original.normalizeGrants(grants), "Grant normalization");
      const bonuses = { ["tokyo/run" + "b".repeat(6)]: 8 + (i % 30), ["nowhere/run" + "c".repeat(6)]: 10 };
      same(actual.normalizeBonuses(bonuses), original.normalizeBonuses(bonuses), "Unrelated bonus normalization");
      const purchases = { ["skin/s" + i]: i * 37, "bad/key": 3 };same(actual.normalizeFilPurchases(purchases), original.normalizeFilPurchases(purchases), "Unrelated purchases");
    }
  } },
  "depth-swept": { path: "game/fil/src/geoDepthModel.js", run(actual, original, same, rnd, count) {
    for (let i = 0; i < count * 4; i++) {
      const z = pick(rnd, [0, 1, rnd()]), previous = pick(rnd, [0, 1, rnd(), undefined]);
      const transfer = i % 5 === 0 ? { from: 0, to: 1, duration: 0.44, elapsed: 0.1 } : null;
      const player = { geoDepth: z, previousGeoDepth: previous, geoDepthTransfer: transfer };
      const object = { geoDepth: pick(rnd, [0, 1, 0.5, rnd(), undefined]), ...(i % 7 === 0 ? { geoDepthHalf: 0.3 } : {}), ...(i % 11 === 0 ? { geoDepthSpan: "all" } : {}) };
      for (const swept of [false, true]) same(actual.geoDepthContact(player, object, swept), original.geoDepthContact(player, object, swept), "Swept depth range and supports");
      const camera = { x: rnd() * 1000, y: rnd() * 500 }, viewport = { width: 800, height: 600 };
      same(actual.geoDepthProjection(z, camera, viewport), original.geoDepthProjection(z, camera, viewport), "Unrelated projection");
    }
  } },
  "cube-angle": { path: "game/fil/src/player3dModel.js", run(actual, original, same, rnd, count) {
    for (let i = 0; i < count * 2; i++) {
      const input = { angle: rnd() * 14 - 7, angularVelocity: rnd() * 20 - 10, dt: pick(rnd, [-0.5, -0.016, 0, 0.016, 0.1]), onGround: i % 4 === 0 };
      same(actual.advancePlayer3dVisualAngle(input), original.advancePlayer3dVisualAngle({ ...input, dt: Math.max(0, input.dt) }), "No rotation for negative dt");
      const pose = { yaw: rnd() * 6, pitch: rnd() * 6, roll: rnd() * 6 };
      same(actual.visibleCubeFaceCount(pose), original.visibleCubeFaceCount(pose), "Unrelated face count");
      same(actual.computePersistentPlayer3dPose({ playerAngle: input.angle, onGround: input.onGround }), original.computePersistentPlayer3dPose({ playerAngle: input.angle, onGround: input.onGround }), "Unrelated persistent pose");
    }
    same(actual.advancePlayer3dVisualAngle(), original.advancePlayer3dVisualAngle(), "Defaults");
  } },
  "platform-collapse": { path: "game/src/core/runtime.js", run(actual, original, same, rnd, count) {
    for (let i = 0; i < count; i++) {
      const collapseAfter = 1 + Math.floor(rnd() * 4), began = Math.floor(rnd() * 10);
      const platform = { id: "p" + i, x: rnd() * 100, y: rnd() * 100, w: 50, h: 10, collapseAfter, ...(i % 3 ? { motion: { dx: 4, dy: 2, period: 3, phase: 1 } } : {}), ...(i % 13 === 0 ? { decor: true } : {}) };
      const state = { collapsing: new Map([[platform.id, began]]) };
      for (const time of [began, began + collapseAfter - 0.5, began + collapseAfter, began + collapseAfter + 0.25, began + collapseAfter + 2]) {
        const expected = platform.decor ? null : time - began > collapseAfter ? null : original.platformPose(platform, time, { collapsing: new Map() });
        same(actual.platformPose(platform, time, state), expected, "Solid through the collapse moment");
      }
      same(actual.platformPose({ ...platform, collisionBearing: false }, began, state), null, "Non-bearing excluded");
    }
    const level = { id: "l", speed: 300, spawn: { x: 10, y: 20 } };
    same(actual.createState(level), original.createState(level), "Unrelated state");
  } },
  "coin-action": { path: "game/fil/src/coinChallengeModel.js", run(actual, original, same, rnd, count) {
    for (let i = 0; i < count * 2; i++) {
      const speedMultiplier = pick(rnd, [undefined, 1, 1.1, 1.25]), speed = 384 * (speedMultiplier ?? 1);
      const action = { kind: i % 9 ? "jump" : "hold", x: Math.round(rnd() * 4000), ...(i % 3 ? { linkedObjectId: "o" + (i % 5) } : {}) };
      const shifted = Math.round(action.x + speed * actual.COIN_CHALLENGE_RULES.lateShiftSeconds), offset = pick(rnd, [-2, -1, 0, 1, 2]);
      const level = { speedMultiplier, testActions: [{ kind: "jump", x: 5 }, action] };
      const challenge = { sourceId: actual.coinChallengeActionSourceId(action, 1), launchX: shifted + offset };
      same(actual.coinChallengeActionExists(level, challenge), action.kind === "jump" && Math.abs(offset) <= 1, "One-pixel tolerance");
      same(actual.coinChallengeActionSourceId(action, i), original.coinChallengeActionSourceId(action, i), "Unrelated source ids");
    }
    same(actual.COIN_CHALLENGE_RULES, original.COIN_CHALLENGE_RULES, "Unchanged rules");
  } },
  "bonus-even": { path: "game/src/core/economy-ledger.js", async run(actual, original, same, rnd, count, load) {
    const { cities } = await load("game/src/content/cities.js");
    for (let i = 0; i < count; i++) {
      const city = pick(rnd, [...cities.map((c: { id: string }) => c.id), "nowhere"]), run = "run-" + "x".repeat(4 + (i % 6)), bonus = pick(rnd, [0, 7, 8, 9, 10, 21, 22, 35, 36, 37, 9.5]);
      const save = { grants: i % 4 ? {} : { [`finish/${city}/${run}`]: 20 } }, expectedSave = structuredClone(save);
      const result = actual.claimCompletion(save, city, run, bonus), expected = original.claimCompletion(expectedSave, city, run, bonus % 2 === 0 ? bonus : 0);
      same(result, expected, "Odd completion bonus rejected");same(save, expectedSave, "Completion grants and saved bonus");
      const saved = { [`${city}/${run}`]: bonus, [`${city}/${run}/x`]: 10 };
      same(actual.normalizeBonuses(saved), Object.fromEntries(Object.entries(original.normalizeBonuses(saved)).filter(([, amount]) => (amount as number) % 2 === 0)), "Odd saved bonus rejected");
      const grants = { "2026-10-14/login": 20, [`finish/${city}/${run}`]: 20 };same(actual.normalizeGrants(grants), original.normalizeGrants(grants), "Unrelated grants");
    }
  } },
  // Larger tasks: a feature across three modules, a rename across modules and a parameter in several places of one function.
  "reward-limit": { path: "game/src/core/reward-policy.js", feature: true, async run(actual, original, same, rnd, count, _load, loadActual) {
    const progression = await loadActual("game/src/core/progression.js"), ledger = await loadActual("game/src/core/economy-ledger.js");
    const now = Date.UTC(2026, 9, 14, 12), day = "2026-10-14";
    same(actual.DAILY_REWARDED_LIMIT, 3, "Default limit kept");
    for (let i = 0; i < count; i++) {
      const rewardLimit = pick(rnd, [undefined, 1, 2, 3, 5, 7, 10, 0, 11, 2.5, "4", -1]), limit = validLimit(rewardLimit) ? rewardLimit as number : 3;
      const used = Math.floor(rnd() * 11), save = { rewardLimit, rewardDay: { day, count: used }, grants: {} };
      const plain = { rewardDay: save.rewardDay, grants: {} };
      same(actual.dailyRewardStatus(save, now), { ...original.dailyRewardStatus(plain, now), remaining: Math.max(0, limit - used), limit }, "Quota uses the save limit");
      const fresh = { ...progression.freshProgress(), ...(rewardLimit === undefined ? {} : { rewardLimit }) };
      const credited = Array.from({ length: 12 }, (_, n) => progression.creditAdReward(fresh, "receipt-" + i + "-" + n, 20, now)).filter(Boolean).length;
      same(credited, limit, "Crediting stops at the save limit");
      same(Object.keys(fresh.grants).sort(), Array.from({ length: limit }, (_, n) => `${day}/ad/${n}`).sort(), "One grant per credited ad");
      const read = progression.readProgress(storage({ version: 1, ...(rewardLimit === undefined ? {} : { rewardLimit }), rewardDay: { day, count: 99 }, grants: fresh.grants }));
      same(read.rewardLimit, validLimit(rewardLimit) ? rewardLimit : undefined, "Valid limit kept, invalid dropped");
      same(read.rewardDay, { day, count: limit }, "Saved count clamped to the save limit");
      same(read.grants, fresh.grants, "Ad grants up to index 9 survive reading");
    }
    same(ledger.normalizeGrants({ "2026-10-14/ad/10": 20, "2026-10-14/ad/x": 20, "2026-10-14/ad/9": 20 }), { "2026-10-14/ad/9": 20 }, "Ad indices 0-9 only");
  } },
  "rename-day": { path: "game/src/core/economy-ledger.js", feature: true, surface: false, async run(actual, original, same, rnd, count, load, loadActual, workspace) {
    same(Object.keys(actual).sort(), Object.keys(original).map(name => name === "validDay" ? "isCalendarDay" : name).sort(), "Renamed export, no alias");
    for (let i = 0; i < count; i++) {
      const day = `20${20 + Math.floor(rnd() * 10)}-${String(1 + Math.floor(rnd() * 13)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 31)).padStart(2, "0")}`;
      same(actual.isCalendarDay(day), original.validDay(day), "Same calendar rule");
    }
    const progression = await loadActual("game/src/core/progression.js"), before = await load("game/src/core/progression.js");
    for (const saved of [{ version: 1, rewardDay: { day: "2026-10-14", count: 2 } }, { version: 1, rewardDay: { day: "2026-02-30", count: 2 } }, { version: 1, grants: { "2026-10-14/login": 20 } }])
      same(progression.readProgress(storage(saved)), before.readProgress(storage(saved)), "Importer still reads progress");
    const { readdirSync, readFileSync, statSync } = await import("node:fs"), { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name);return statSync(path).isDirectory() ? walk(path) : /\.m?js$/.test(name) ? [path] : []; });
    const left = ["game/src", "game/fil/src"].flatMap(dir => walk(join(workspace, dir))).filter(path => /\bvalidDay\b/.test(readFileSync(path, "utf8")));
    same(left.map(path => path.slice(workspace.length + 1)), [], "No validDay left in game sources");
  } },
  "depth-body": { path: "game/fil/src/geoDepthModel.js", feature: true, run(actual, original, same, rnd, count) {
    for (let i = 0; i < count * 4; i++) {
      const half = pick(rnd, [undefined, 0.05, 0.12, 0.3, 0, -1, NaN, "0.4"]), own = Number.isFinite(half) && (half as number) > 0 ? half as number : 0.12;
      const z = pick(rnd, [0, 1, rnd()]), previous = pick(rnd, [0, 1, rnd(), undefined]);
      const transfer = i % 4 === 0 ? { from: 0, to: 1, duration: 0.44, elapsed: 0.1 } : null;
      const player = { geoDepth: z, previousGeoDepth: previous, geoDepthTransfer: transfer, ...(half === undefined ? {} : { depthBodyHalf: half }) };
      const object = { geoDepth: pick(rnd, [0, 1, 0.5, rnd(), undefined]), ...(i % 7 === 0 ? { geoDepthHalf: 0.3 } : {}), ...(i % 11 === 0 ? { geoDepthSpan: "all" } : {}) };
      for (const swept of [false, true]) {
        const radius = own + (object.geoDepthHalf ?? 0.12), objectZ = object.geoDepth ?? 0, from = swept ? previous ?? z : z;
        const expected = object.geoDepthSpan === "all" ? true : !swept && transfer ? objectZ >= Math.min(transfer.from, transfer.to) - radius && objectZ <= Math.max(transfer.from, transfer.to) + radius
          : objectZ >= Math.min(z, from) - radius && objectZ <= Math.max(z, from) + radius;
        same(actual.geoDepthContact(player, object, swept), expected, "Hero half depth in every contact test");
        if (half === undefined) same(actual.geoDepthContact(player, object, swept), original.geoDepthContact(player, object, swept), "Default unchanged");
      }
    }
    same(actual.DEPTH_BODY_HALF, original.DEPTH_BODY_HALF, "Constant kept");
  } },
};

export async function checkHoldoutTask(load: (root: string, path: string) => Promise<Module>, workspace: string, baseline: string, task: string, smoke: boolean) {
  const check = HOLDOUT[task] ?? SEMVER[task] ?? SUPERSTRUCT[task];if (!check) throw Error("Unknown speed task");
  let checks = 0, seed = smoke ? 239 : 99173;
  const same: Same = (actual, expected, name) => { checks++;assert.deepEqual(actual, expected, name); };
  const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
  // TypeScript checks transpile and load their project themselves; there is no module to import directly.
  const typescript = check.path.endsWith(".ts"), actual = typescript ? {} : await load(workspace, check.path), original = typescript ? {} : await load(baseline, check.path);
  if (check.feature && workspace === baseline) return { pass: false, behavior_pass: true, checks, mode: "baseline-behavior-only" };
  // A feature may add exports; every original export must remain.
  if (check.surface !== false && !typescript) same(check.feature ? Object.keys(original).filter(name => !(name in actual)) : Object.keys(actual).sort(), check.feature ? [] : Object.keys(original).sort(), "Export surface");
  await check.run(actual, original, same, rnd, smoke ? 6 : 90, path => load(baseline, path), path => load(workspace, path), workspace, baseline);
  return { pass: true, behavior_pass: true, checks, mode: smoke ? "public-smoke" : "independent-final" };
}
