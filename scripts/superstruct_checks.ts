import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { hash } from "../src/code-memory/source.js";
import type { HoldoutCheck } from "./holdout_checks.js";

// Third project: superstruct 2.0.2 (TypeScript). Its sources import './x.js', so each checkout is transpiled to a temporary
// ES module tree before loading; the repaired and the original library are then compared on fixed and seeded inputs.
const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
const sources = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name);return statSync(path).isDirectory() ? sources(path) : name.endsWith(".ts") ? [path] : []; });
export async function loadSuperstruct(root: string): Promise<Record<string, any>> {
  const files = sources(join(root, "src")), digest = hash(files.map(file => relative(root, file) + ":" + hash(readFileSync(file))).join("\n")).slice(0, 24);
  const out = join(tmpdir(), "cm-superstruct-" + digest);
  for (const file of files) {
    const target = join(out, relative(root, file)).replace(/\.ts$/, ".js");mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText);
  }
  writeFileSync(join(out, "package.json"), '{"type":"module"}');
  return import(pathToFileURL(join(out, "src/index.js")).href);
}
const validate = (s: Record<string, any>, value: unknown, struct: unknown, options?: object) => { const [error, result] = s.validate(value, struct, options);return error ? { error: error.message } : { result }; };

export const SUPERSTRUCT: Record<string, HoldoutCheck> = {
  "size-max": { path: "src/structs/refinements.ts", async run(_a, _o, same, rnd, count, _l, _la, workspace, baseline) {
    const s = await loadSuperstruct(workspace), o = await loadSuperstruct(baseline);
    same(s.is(5, s.size(s.number(), 1, 5)), true, "Number equal to max");
    same(s.is(new Date(10), s.size(s.date(), 1, 10)), true, "Date equal to max");
    for (let i = 0; i < count * 2; i++) {
      const min = Math.floor(rnd() * 4), max = min + Math.floor(rnd() * 4), n = Math.floor(rnd() * 9);
      const values: [unknown, string][] = [[n, "number"], ["x".repeat(n), "string"], [Array(n).fill(0), "array"], [new Set(Array.from({ length: n }, (_, k) => k)), "set"]];
      for (const [value, kind] of values) {
        same(s.is(value, s.size(s[kind](), min, max)), min <= n && n <= max, `Inclusive ${kind} bounds`);
        same(validate(s, value, s.size(s[kind](), min, max)).error ?? null, validate(o, value, o.size(o[kind](), min, max)).error ?? (min <= n && n <= max ? null : "?"), `Same ${kind} message`);
      }
    }
  } },
  "plain-object": { path: "src/utils.ts", async run(_a, _o, same, _rnd, count, _l, _la, workspace, baseline) {
    const s = await loadSuperstruct(workspace), o = await loadSuperstruct(baseline);
    class Box { a = 1; }
    for (let i = 0; i < count; i++) {
      const struct = (x: Record<string, any>) => x.defaulted(x.type({ a: x.number() }), { b: i });
      const bare = Object.assign(Object.create(null), { a: i });
      same({ ...s.create(bare, struct(s)) }, { a: i, b: i }, "Null-prototype objects are plain");
      for (const value of [{ a: i }, new Box(), [i], new Map(), null, "x"]) same(validate(s, value, struct(s), { coerce: true }), validate(o, value, struct(o), { coerce: true }), "Other values unchanged");
    }
  } },
  "defaulted-null": { path: "src/structs/coercions.ts", async run(_a, _o, same, _rnd, count, _l, _la, workspace, baseline) {
    const s = await loadSuperstruct(workspace), o = await loadSuperstruct(baseline);
    same(validate(s, null, s.defaulted(s.nullable(s.number()), 4), { coerce: true }), { result: null }, "null is a value, not a missing one");
    for (let i = 0; i < count; i++) {
      const value = [undefined, 0, "", 7, { a: 1 }, { b: 2 }, false][i % 7], fallback = i % 2 ? { a: 9, b: 8 } : 3;
      const struct = (x: Record<string, any>) => x.defaulted(x.any(), fallback, { strict: i % 3 === 0 });
      same(validate(s, value, struct(s), { coerce: true }), validate(o, value, struct(o), { coerce: true }), "Unchanged defaults");
    }
  } },
  "union-mask": { path: "src/structs/types.ts", async run(_a, _o, same, _rnd, count, _l, _la, workspace, baseline) {
    const s = await loadSuperstruct(workspace), o = await loadSuperstruct(baseline);
    for (let i = 0; i < count; i++) {
      const value = [{ a: 1, extra: 2 }, { b: "x", extra: 1 }, { a: "no" }, 5][i % 4];
      const struct = (x: Record<string, any>) => x.union([x.object({ a: x.number() }), x.object({ b: x.string() })]);
      for (const options of [{ coerce: true, mask: true }, { coerce: true }, {}]) same(validate(s, value, struct(s), options), validate(o, value, struct(o), options), "Union masks its members");
    }
  } },
  "integer-infinite": { path: "src/structs/types.ts", async run(_a, _o, same, rnd, count, _l, _la, workspace, baseline) {
    const s = await loadSuperstruct(workspace), o = await loadSuperstruct(baseline);
    for (const value of [Infinity, -Infinity, NaN, 1.5, 3, -2, 0, "4", null]) same(s.is(value, s.integer()), o.is(value, o.integer()), "Integers only: " + String(value));
    for (let i = 0; i < count; i++) { const value = (rnd() - 0.5) * 100;same(s.is(value, s.number()), o.is(value, o.number()), "Unrelated number"); }
  } },
  "rename-plain": { path: "src/utils.ts", feature: true, surface: false, async run(_a, _o, same, _rnd, count, _l, _la, workspace, baseline) {
    const s = await loadSuperstruct(workspace), o = await loadSuperstruct(baseline);
    same(Object.keys(s).sort(), Object.keys(o).sort(), "Public exports unchanged");
    const utils = sources(join(workspace, "src")).map(file => [relative(workspace, file), readFileSync(file, "utf8")] as const);
    same(utils.filter(([, text]) => /\bisPlainObject\b/.test(text)).map(([path]) => path), [], "No isPlainObject left");
    same(utils.some(([path, text]) => path === "src/utils.ts" && /export function isPlainRecord\b/.test(text)), true, "isPlainRecord exported from utils");
    for (let i = 0; i < count; i++) {
      const value = [{ a: i }, Object.assign(Object.create(null), { a: i }), [i], null][i % 4];
      const struct = (x: Record<string, any>) => x.defaulted(x.type({ a: x.number() }), { b: i });
      same(validate(s, value, struct(s), { coerce: true }), validate(o, value, struct(o), { coerce: true }), "Same defaults");
    }
  } },
};
