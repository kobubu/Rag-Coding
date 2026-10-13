import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { SchemaObject, ValidateFunction } from "ajv";
import { isMain, readJson, ROOT, sha256, walkObjects, writeJson } from "./lib.js";
import { runFixtureChecks } from "./probe_chunking.js";
import { render } from "./render_backlog.js";
import type { Plan } from "./render_backlog.js";

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

export function validatePlan(plan: Plan): { tasks: number; milestones: number; done: number } {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const milestones = new Map(plan.milestones.map((item) => [item.id, item]));
  assert.equal(byId.size, plan.tasks.length, "Duplicate task IDs");
  assert.equal(milestones.size, plan.milestones.length, "Duplicate milestone IDs");
  for (const task of plan.tasks) {
    assert(/^RC-\d{3}$/.test(task.id) && milestones.has(task.milestone), `Invalid task identity: ${task.id}`);
    assert(["planned", "done", "blocked"].includes(task.status) && ["S", "M", "L"].includes(task.size),
      `Invalid task status/size: ${task.id}`);
    assert(task.acceptance.length && task.artifacts.length && task.title, `Incomplete task: ${task.id}`);
    assert.equal(new Set(task.depends_on).size, task.depends_on.length, `Duplicate dependency: ${task.id}`);
    for (const dependency of task.depends_on) {
      const prerequisite = byId.get(dependency);
      assert(prerequisite && dependency !== task.id, `Unknown/self dependency: ${task.id} -> ${dependency}`);
      assert(task.status !== "done" || prerequisite.status === "done", `Done task has unfinished prerequisite: ${task.id}`);
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string): void {
    assert(!active.has(id), `Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)!.depends_on) visit(dependency);
    active.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  for (const milestone of milestones.values()) {
    const members = plan.tasks.filter((task) => task.milestone === milestone.id);
    assert(members.length && (milestone.status !== "completed" || members.every((task) => task.status === "done")),
      `Invalid milestone state: ${milestone.id}`);
  }
  assert(milestones.has(plan.mvp_through), "Unknown MVP milestone");
  return { tasks: plan.tasks.length, milestones: milestones.size, done: plan.tasks.filter((task) => task.status === "done").length };
}

export interface ContractExample {
  schema: string;
  value: Record<string, unknown>;
}

export function validateContractExamples(schema: SchemaObject, examples: ContractExample[], raw: Buffer): number {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert(ajv.validateSchema(schema), `Invalid schema: ${ajv.errorsText()}`);
  assert(typeof schema.$schema === "string", "Missing JSON Schema dialect");
  const definitions = schema.$defs as Record<string, SchemaObject>;
  for (const item of walkObjects(schema)) {
    if ("$ref" in item) {
      assert(typeof item.$ref === "string" && item.$ref.startsWith("#/$defs/") &&
        Object.hasOwn(definitions, item.$ref.slice("#/$defs/".length)), `Unknown/external schema reference: ${item.$ref}`);
    }
  }
  const blobHash = sha256(raw);
  assert(examples.length, "Missing contract examples");
  for (const example of examples) {
    assert(Object.hasOwn(definitions, example.schema), `Unknown contract example: ${example.schema}`);
    const selected: SchemaObject = { $schema: schema.$schema, $defs: definitions, $ref: "#/$defs/" + example.schema };
    const validate: ValidateFunction = ajv.compile(selected);
    assert(validate(example.value), `Invalid ${example.schema}: ${ajv.errorsText(validate.errors)}`);
    for (const item of walkObjects(example.value)) {
      if ("file_version_id" in item && "start_byte" in item && "end_byte" in item) {
        assert(item.file_version_id === "blob:" + blobHash && typeof item.start_byte === "number" &&
          typeof item.end_byte === "number" && 0 <= item.start_byte && item.start_byte < item.end_byte &&
          item.end_byte <= raw.length, `Invalid fixture span in ${example.schema}`);
        assert(typeof item.line_start === "number" && typeof item.line_end === "number" &&
          item.line_start <= item.line_end, `Invalid line range in ${example.schema}`);
      }
      if ("source_hash" in item) assert.equal(item.source_hash, blobHash, `Wrong fixture hash: ${example.schema}`);
    }
    if (example.schema === "CodeUnit") {
      const span = example.value.source_span as { start_byte: number; end_byte: number };
      assert.equal(sha256(raw.subarray(span.start_byte, span.end_byte)), example.value.content_hash,
        "CodeUnit content hash does not match exact fixture bytes");
    }
    if (example.schema === "ContextPackage") {
      const value = example.value as { tokens_used: number | null; budget_tokens: number };
      assert(value.tokens_used === null || value.tokens_used <= value.budget_tokens, "ContextPackage exceeds declared budget");
    }
  }
  return examples.length;
}

if (isMain(import.meta.url)) {
  for (const path of publicFiles(".json")) readJson(path);
  const markdown = checkMarkdown();
  const plan = readJson<Plan>(join(ROOT, "plans/backlog.json"));
  const planResult = validatePlan(plan);
  assert.equal(readFileSync(join(ROOT, "plans/BACKLOG.md"), "utf8"), render(plan), "BACKLOG.md is stale; run npm run backlog");
  const schema = readJson<SchemaObject>(join(ROOT, "contracts/core.schema.json"));
  const examples = publicFiles(".json", join(ROOT, "contracts/examples")).map((path) => readJson<ContractExample>(path));
  const exampleCount = validateContractExamples(schema, examples, readFileSync(join(ROOT, "fixtures/batching.ts")));
  const fixture = runFixtureChecks();
  const result = {
    status: "PASS", runtime: process.version, language: "typescript",
    markdown_documents: markdown.documents, local_links: markdown.links, plan: planResult,
    contract_examples: exampleCount, fixture_variants: fixture.fixture_variants.length,
    limits: "Documentation and structural fixture only; no RAG quality or product runtime claim",
  };
  writeJson(join(ROOT, ".artifacts/docs-check.json"), result);
  console.log(JSON.stringify(result));
}
