import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { bundlePatchFiles, composeEntries } from "@deepseek-ai/dsh-app-boot";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import type { PatchOptions } from "@deepseek-ai/cordis-plugin-include";
import { load } from "js-yaml";
import { ROOT } from "../scripts/lib.js";

test("Harness accepts package metadata and actually inserts the CM plugin into a profile", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const paths = bundlePatchFiles(manifest.dsh.bundle);
  assert.deepEqual(paths, ["harness/bundle.yml"]);
  const layers = paths.map((path) => load(readFileSync(join(ROOT, path), "utf8"), { schema: entryListSchema }) as PatchOptions[]);
  const warnings: string[] = [];
  const entries = composeEntries(layers, (warning) => warnings.push(warning));
  assert.deepEqual(warnings, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "code-memory");
  assert.equal(entries[0]?.name, manifest.name);
  assert.deepEqual(entries[0]?.config, { mode: "compact", autoContext: true, autoUpdate: true });
});
