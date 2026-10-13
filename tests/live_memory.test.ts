import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { LiveMemory } from "../src/code-memory/live.js";
import { EMBEDDING } from "../src/code-memory/vector.js";
import type { Embedder } from "../src/code-memory/vector.js";
import { retrieveContext } from "../src/code-memory/retrieve.js";
import { hash } from "../src/code-memory/source.js";

const embed: Embedder = async texts => texts.map(() => { const vector = Array<number>(EMBEDDING.dimensions).fill(0);vector[0] = 1;return vector; });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cm-live-")), directory = join(root, ".code-memory/live");
  writeFileSync(join(root, "a.js"), "export function value(){return 1;}\n");
  writeFileSync(join(root, "b.js"), "import {value} from './a.js';export function consumer(){return value();}\n");
  return { root, directory, options: { projectRoot: root, directory, modelCache: root } };
}
test("live generations track edits, additions, renames and deletion while rebinding import graph and reusing embeddings", async () => {
  const data = fixture(), live = new LiveMemory(data.options, embed), signal = new AbortController().signal;
  try {
    const first = await live.ready(signal);const pointer = readFileSync(join(data.directory, "current.json"), "utf8");
    const oldHash = hash(readFileSync(first.store.indexPath));
    writeFileSync(join(data.root, "a.js"), "export function value(){return 2;}\n");
    const changed = await live.ready(signal);assert.notEqual(changed.index.snapshot_id, first.index.snapshot_id);assert(live.metadata()!.reused > 0);
    await assert.rejects(live.ready(signal, first.index.snapshot_id), /snapshot_mismatch/);
    const context = await live.use(signal, undefined, (index, vectors) => retrieveContext(index, vectors, "`consumer`", 2000, signal, { policy: "adaptive" }));
    assert(context.parts.some(part => part.text.includes("return 2")));assert(!context.parts.some(part => part.text.includes("return 1")));
    writeFileSync(join(data.root, "c.js"), "export function added(){return 3;}\n");
    assert((await live.ready(signal)).index.symbols.some(symbol => symbol.name === "added"));
    renameSync(join(data.root, "a.js"), join(data.root, "renamed.js"));writeFileSync(join(data.root, "b.js"), "import {value} from './renamed.js';export function consumer(){return value();}\n");
    const renamed = await live.ready(signal);assert(!renamed.index.files.some(file => file.path === "a.js"));assert(renamed.index.relations.some(edge => edge.predicate === "calls"));
    unlinkSync(join(data.root, "c.js"));assert(!(await live.ready(signal)).index.symbols.some(symbol => symbol.name === "added"));
    assert.equal(hash(readFileSync(first.store.indexPath)), oldHash);assert.notEqual(readFileSync(join(data.directory, "current.json"), "utf8"), pointer);
  } finally { live.close(); }
});
test("syntax/build failure leaves the pointer intact and source changes during an embedding build cannot publish stale facts", async () => {
  const data = fixture();let fail = false, race = false;
  const controlled: Embedder = async (texts, signal) => { if (fail) throw Error("Embedding unavailable");if (race) { race = false;writeFileSync(join(data.root, "a.js"), "export function value(){return 5;}\n"); }return embed(texts, signal); };
  const live = new LiveMemory(data.options, controlled), signal = new AbortController().signal;
  try {
    await live.ready(signal);const pointer = readFileSync(join(data.directory, "current.json"), "utf8");
    writeFileSync(join(data.root, "a.js"), "export function value(){");await assert.rejects(live.ready(signal), /syntax errors/);assert.equal(readFileSync(join(data.directory, "current.json"), "utf8"), pointer);
    writeFileSync(join(data.root, "a.js"), "export function value(){return 4;}\n");fail = true;await assert.rejects(live.ready(signal), /Embedding unavailable/);assert.equal(readFileSync(join(data.directory, "current.json"), "utf8"), pointer);
    fail = false;race = true;const latest = await live.ready(signal);assert(latest.index.files.find(file => file.path === "a.js")!.source.includes("return 5"));
    assert.equal(JSON.parse(readFileSync(join(data.directory, "current.json"), "utf8")).snapshot_id, latest.index.snapshot_id);
  } finally { live.close(); }
});
test("actual Git branch switch, inherited compiler config and writer recovery keep source/model/policy fences", async () => {
  const data = fixture(), git = (...args: string[]) => execFileSync("git", args, { cwd: data.root, stdio: "pipe", windowsHide: true });
  git("init", "--initial-branch=one");git("config", "user.name", "CM Fixture");git("config", "user.email", "cm-fixture@example.invalid");git("add", "a.js", "b.js");git("commit", "-m", "one");git("checkout", "-b", "two");
  writeFileSync(join(data.root, "a.js"), "export function value(){return 9;}\n");git("add", "a.js");git("commit", "-m", "two");git("checkout", "one");
  mkdirSync(join(data.root, "config"));writeFileSync(join(data.root, "tsconfig.json"), '{"extends":"./config/base.json","compilerOptions":{"allowJs":true,"checkJs":false}}');
  writeFileSync(join(data.root, "config/base.json"), '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","types":[]}}');
  mkdirSync(data.directory, { recursive: true });writeFileSync(join(data.directory, "writer.lock"), JSON.stringify({ pid: 1073741824, token: "crashed-writer" }));
  const live = new LiveMemory(data.options, embed), signal = new AbortController().signal;
  try {
    const one = await live.ready(signal), original = hash(readFileSync(one.store.indexPath));
    git("checkout", "two");const two = await live.ready(signal);assert.notEqual(one.index.snapshot_id, two.index.snapshot_id);
    git("checkout", "one");const restored = await live.ready(signal);assert.equal(restored.index.snapshot_id, one.index.snapshot_id);assert.equal(hash(readFileSync(one.store.indexPath)), original);
    writeFileSync(join(data.root, "config/base.json"), '{"compilerOptions":{"target":"ES2021","module":"NodeNext","moduleResolution":"NodeNext","types":[]}}');
    assert.notEqual((await live.ready(signal)).index.snapshot_id, one.index.snapshot_id);
    const foreign = new LiveMemory({ ...data.options, projectRoot: mkdtempSync(join(tmpdir(), "cm-foreign-")) }, embed);
    await assert.rejects(foreign.ready(signal), /scope\/model\/policy mismatch/);foreign.close();
  } finally { live.close(); }
});
test("background watcher publishes without queries; single-flight waiters can cancel without cancelling another reader", async () => {
  const data = fixture(), live = new LiveMemory(data.options, embed), signal = new AbortController().signal;
  try {
    await live.ready(signal);const first = live.metadata()!.snapshot_id;live.startWatching(60);
    writeFileSync(join(data.root, "a.js"), "export function value(){return 11;}\n");
    const deadline = performance.now() + 10000;
    while (live.metadata()!.snapshot_id === first && performance.now() < deadline) await setTimeout(60);
    assert.notEqual(live.metadata()!.snapshot_id, first);assert(live.watchStatus().watching);
  } finally { live.close(); }
  const other = fixture();let release!: () => void, started!: () => void;
  const wait = new Promise<void>(done => { release = done; }), begin = new Promise<void>(done => { started = done; });
  const slow: Embedder = async (texts, signal) => { started();await wait;return embed(texts, signal); };
  const shared = new LiveMemory(other.options, slow), cancel = new AbortController();
  try { const a = shared.ready(cancel.signal);await begin;const b = shared.ready(signal);cancel.abort();await assert.rejects(a);release();assert((await b).index.files.length === 2); }
  finally { release();shared.close(); }
});

test("explicit source scope admits new saved files while unrelated syntax errors and edits stay outside the generation", async () => {
  const data = fixture();mkdirSync(join(data.root, "game"));
  writeFileSync(join(data.root, "game/inside.js"), "export function inside(){return 1;}\n");
  writeFileSync(join(data.root, "outside.js"), "export function broken( {\n");
  const live = new LiveMemory({ ...data.options, sourceScope: "game" }, embed), signal = new AbortController().signal;
  try {
    const first = await live.ready(signal);assert.deepEqual(first.index.files.map(file => file.path), ["game/inside.js"]);
    writeFileSync(join(data.root, "outside.js"), "export function stillBroken( {\n");
    assert.equal((await live.ready(signal)).index.snapshot_id, first.index.snapshot_id);
    writeFileSync(join(data.root, "game/new.ts"), "export function newValue(): number { return 2; }\n");
    const added = await live.ready(signal);assert.equal(added.index.files.length, 2);assert.notEqual(added.index.snapshot_id, first.index.snapshot_id);
    const result = await live.use(signal, undefined, (index, vectors) => retrieveContext(index, vectors, "newValue", 1000, signal, { policy: "adaptive" }));
    assert(result.parts.some(part => part.path === "game/new.ts"));assert(!result.parts.some(part => part.path === "outside.js"));
    assert.throws(() => new LiveMemory({ ...data.options, sourceScope: "../outside" }, embed), /Invalid source scope/);
  } finally { live.close(); }
});
