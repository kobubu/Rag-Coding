import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { CM_VERSION } from "../src/version.js";
import { ROOT } from "./lib.js";

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
assert.equal(manifest.version, CM_VERSION, "Package and compiled version must match");
for (const name of ["build", "prepare", "prepack", "preinstall", "install", "postinstall"]) {
  assert(!manifest.scripts[name], `Use compile, not ${name}: Git installs must consume the committed runtime without a build`);
}
for (const path of [manifest.main, manifest.types, ...Object.values(manifest.bin) as string[], "dist/viewer/index.html", "harness/bundle.yml"]) {
  assert(existsSync(join(ROOT, path)), `Missing packaged entry: ${path}`);
}
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  assert(!entry.isSymbolicLink(), "Runtime artifacts must be ordinary files");
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [relative(ROOT, path).replaceAll("\\", "/")];
});
const files = ["dist/src", "dist/viewer"].flatMap(path => walk(join(ROOT, path))).sort();
const tracked = execFileSync("git", ["ls-files", "-z", "--", "dist/src", "dist/viewer"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean).sort();
assert.deepEqual(files, tracked, "Stage the freshly compiled runtime; only dist/src and dist/viewer belong in Git");
try { execFileSync("git", ["diff", "--quiet", "--", "dist/src", "dist/viewer"], { cwd: ROOT, windowsHide: true, stdio: "pipe" }); }
catch { throw new Error("Committed runtime differs from the current build; compile and stage dist/src and dist/viewer"); }
console.log(JSON.stringify({ status: "PASS", version: CM_VERSION, runtime_files: files.length, git_runtime_matches_build: true, install_build_required: false }));
