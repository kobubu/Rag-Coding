import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { SchemaObject } from "ajv";
import { isMain, readJson, ROOT, writeJson } from "./lib.js";
import { runFixtureChecks } from "./probe_chunking.js";

const IGNORED = new Set([".git", ".artifacts", ".code-memory", ".venv", "__pycache__", "node_modules", "dist"]);

function publicFiles(suffix: string, directory = ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (path === join(ROOT, "research/chunking-probe.json")) return [];
    if (entry.isDirectory()) return publicFiles(suffix, path);
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
  }).sort();
}

function headingAnchor(heading: string): string {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, "").replaceAll(" ", "-");
}

function checkMarkdown(): { documents: number; links: number } {
  let links = 0;
  const documents = publicFiles(".md");
  for (const path of documents) {
    const text = readFileSync(path, "utf8");
    assert(!text.includes("\ufffd"), `Replacement character in ${relative(ROOT, path)}`);
    assert.equal([...text.matchAll(/^\s*```/gm)].length % 2, 0, `Unclosed code fence: ${path}`);
    const withoutFences = text.replace(/^\s*```[^\n]*\n.*?^\s*```[^\n]*$/gms, "");
    for (const match of withoutFences.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]!.trim().replace(/^<|>$/g, "");
      const scheme = target.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
      if (scheme && ["https", "http", "mailto"].includes(scheme)) continue;
      assert(!scheme && !isAbsolute(target), `Non-portable link: ${target}`);
      const [pathname = "", fragment] = target.split("#");
      const resolved = pathname ? resolve(dirname(path), decodeURIComponent(pathname.split("?")[0]!)) : path;
      const fromRoot = relative(ROOT, resolved);
      assert(!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith("..\\") &&
        !fromRoot.startsWith("../") && existsSync(resolved), `Missing or external local target: ${target}`);
      if (fragment && extname(resolved) === ".md") {
        const anchors = [...readFileSync(resolved, "utf8").matchAll(/^#+\s+(.+)$/gm)]
          .map((heading) => headingAnchor(heading[1]!));
        assert(anchors.includes(decodeURIComponent(fragment)), `Missing local anchor: ${target}`);
      }
      links++;
    }
  }
  return { documents: documents.length, links };
}

if (isMain(import.meta.url)) {
  for (const path of publicFiles(".json")) readJson(path);
  const markdown = checkMarkdown();
  // The local index schema is loaded by the runtime; it must stay a valid strict JSON Schema.
  const schema = readJson<SchemaObject>(join(ROOT, "contracts/cm-local.schema.json"));
  assert(new Ajv2020({ allErrors: true, strict: true }).validateSchema(schema), "Invalid contracts/cm-local.schema.json");
  const fixture = runFixtureChecks();
  const result = {
    status: "PASS", runtime: process.version, language: "typescript",
    markdown_documents: markdown.documents, local_links: markdown.links, fixture_variants: fixture.fixture_variants.length,
    limits: "Documentation and structural fixture only; no RAG quality or product runtime claim",
  };
  writeJson(join(ROOT, ".artifacts/docs-check.json"), result);
  console.log(JSON.stringify(result));
}
