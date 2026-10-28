import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HoldoutCheck } from "./holdout_checks.js";

// Second project: node-semver 7.6.3 (CommonJS). Seeded bugs and one rename, graded differentially against the original
// package on fixed and seeded random versions and ranges.
const cjs = (module: Record<string, any>) => module.default ?? module;
const ids = ["alpha", "beta", "rc", "0", "1", "2", "11", "x7", "a-b"];
function version(rnd: () => number, pre = 0.5) {
  const n = () => Math.floor(rnd() * 4);
  const core = `${n()}.${n()}.${n()}`;
  if (rnd() >= pre) return core;
  return core + "-" + Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ids[Math.floor(rnd() * ids.length)]).join(".");
}
const ranges = ["^0.2.3", "^0.0.3", "^1.2.3", "^0.2", "^0.x", "^1.x", "~0.2.3", "^0.2.3-beta.1", "^0.0.3-rc", ">=0.1.0 <0.3.0", "^0.2.3 || ^1.0.0", "1.x", "*"];

export const SEMVER: Record<string, HoldoutCheck> = {
  "ident-numeric": { path: "internal/identifiers.js", async run(actual, original, same, rnd, count, load, loadActual) {
    const a = cjs(actual), o = cjs(original);
    for (const [x, y, expected] of [["1", "alpha", -1], ["alpha", "1", 1], ["2", "11", -1], ["beta", "alpha", 1], ["7", "7", 0]] as const) same(a.compareIdentifiers(x, y), expected, "Numeric identifiers sort before alphanumeric");
    const semver = cjs(await loadActual("index.js")), before = cjs(await load("index.js"));
    for (let i = 0; i < count * 3; i++) {
      const x = ids[Math.floor(rnd() * ids.length)]!, y = ids[Math.floor(rnd() * ids.length)]!;
      same(a.compareIdentifiers(x, y), o.compareIdentifiers(x, y) === 0 ? 0 : -1 * -1 * fixed(x, y), "Identifier precedence");
      same(a.rcompareIdentifiers(x, y), -fixed(x, y) || 0, "Reverse precedence");
      const v = version(rnd, 0.9), w = version(rnd, 0.9);
      same(semver.compare(v, w), expectedCompare(before, v, w), "Version precedence");
    }
    function fixed(x: string, y: string) {
      const xn = /^[0-9]+$/.test(x), yn = /^[0-9]+$/.test(y);
      if (xn && yn) return +x === +y ? 0 : +x < +y ? -1 : 1;
      return x === y ? 0 : xn ? -1 : yn ? 1 : x < y ? -1 : 1;
    }
    // The original package with the original identifier rule is the reference for whole versions.
    function expectedCompare(reference: Record<string, any>, v: string, w: string) { return reference.compare(v, w); }
  } },
  "diff-prerelease": { path: "functions/diff.js", run(actual, original, same, rnd, count) {
    const a = cjs(actual), o = cjs(original);
    for (const [x, y, expected] of [["1.1.0-1", "1.1.0", "minor"], ["1.0.1-1", "1.0.1", "patch"], ["1.0.0-1", "1.0.0", "major"], ["1.1.1-1", "1.1.1", "patch"]] as const) same(a(x, y), expected, "Prerelease to release step: " + x);
    for (let i = 0; i < count * 3; i++) { const v = version(rnd), w = version(rnd);same(a(v, w), o(v, w), "Version difference"); }
  } },
  "caret-zero": { path: "classes/range.js", async run(actual, original, same, rnd, count, load, loadActual) {
    const semver = cjs(await loadActual("index.js")), before = cjs(await load("index.js"));
    same(semver.satisfies("0.3.0", "^0.2.3"), false, "Zero-major caret stays in its minor");
    same(semver.satisfies("0.2.9", "^0.2.3"), true, "Zero-major caret allows patches");
    for (let i = 0; i < count * 3; i++) {
      const v = version(rnd, 0.3), range = ranges[Math.floor(rnd() * ranges.length)]!;
      for (const options of [{}, { includePrerelease: true }]) same(semver.satisfies(v, range, options), before.satisfies(v, range, options), "Range membership: " + v + " " + range);
    }
    for (const range of ranges) same(new semver.Range(range).range, new before.Range(range).range, "Range expansion: " + range);
    same(Object.keys(cjs(actual)).sort(), Object.keys(cjs(original)).sort(), "Range class surface");
  } },
  "inc-prerelease": { path: "classes/semver.js", async run(_actual, _original, same, rnd, count, load, loadActual) {
    const semver = cjs(await loadActual("index.js")), before = cjs(await load("index.js"));
    same(semver.inc("1.2.3", "prerelease"), "1.2.4-0", "Prerelease of a release bumps the patch");
    same(semver.inc("1.2.3", "prerelease", "beta"), "1.2.4-beta.0", "With identifier");
    for (let i = 0; i < count * 3; i++) {
      const v = version(rnd);
      for (const type of ["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"])
        for (const id of [undefined, "beta"]) same(semver.inc(v, type, id), before.inc(v, type, id), `Increment ${v} ${type} ${id}`);
    }
  } },
  "coerce-default": { path: "functions/coerce.js", run(actual, original, same, rnd, count) {
    const a = cjs(actual), o = cjs(original), text = (value: unknown) => value === null ? null : String(value);
    for (const [input, expected] of [["v2.5", "2.5.0"], ["2", "2.0.0"], ["3.1.4", "3.1.4"], ["x 7.8 y", "7.8.0"]] as const) same(text(a(input)), expected, "Missing parts default to 0: " + input);
    for (let i = 0; i < count * 3; i++) {
      const input = ["v", "", "ver ", "~"][Math.floor(rnd() * 4)] + version(rnd, 0.3).split(".").slice(0, 1 + Math.floor(rnd() * 3)).join(".") + ["", ".9", "-rc.1", " x"][Math.floor(rnd() * 4)];
      for (const options of [{}, { rtl: true }, { includePrerelease: true }]) same(text(a(input, options)), text(o(input, options)), "Coercion: " + input);
    }
  } },
  "rename-options": { path: "internal/parse-options.js", feature: true, surface: false, async run(actual, original, same, rnd, count, load, loadActual, workspace) {
    const a = cjs(actual), o = cjs(original);
    for (const options of [undefined, true, { loose: true, other: 1 }, { includePrerelease: true }, "x"]) same(a(options), o(options), "Same option normalization");
    const semver = cjs(await loadActual("index.js")), before = cjs(await load("index.js"));
    for (let i = 0; i < count; i++) {
      const v = version(rnd), range = ranges[Math.floor(rnd() * ranges.length)]!;
      same(semver.satisfies(v, range, { loose: true }), before.satisfies(v, range, { loose: true }), "Classes still normalize options");
      same(semver.valid(" " + v, true), before.valid(" " + v, true), "Loose parsing");
    }
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name);return name === "node_modules" || name === "test" || name.startsWith(".") ? [] : statSync(path).isDirectory() ? walk(path) : name.endsWith(".js") ? [path] : []; });
    same(walk(workspace).filter(path => /\bparseOptions\b/.test(readFileSync(path, "utf8"))).map(path => path.slice(workspace.length + 1)), [], "No parseOptions left in package sources");
  } },
};
