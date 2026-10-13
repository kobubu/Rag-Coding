import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { isMain, ROOT, sha256, writeJson } from "./lib.js";

type ByteSpan = [number, number];

export function byteOffset(source: string, position: number): number {
  assert(Number.isInteger(position) && position >= 0 && position <= source.length, "Invalid UTF-16 position");
  const left = source.charCodeAt(position - 1);
  const right = source.charCodeAt(position);
  assert(!(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff), "Position splits a surrogate pair");
  return Buffer.byteLength(source.slice(0, position), "utf8");
}

function analysisProgram(source: string, path: string): { program: ts.Program; file: ts.SourceFile } {
  const filename = resolve(path);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    noResolve: true,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(name) === filename
      ? ts.createSourceFile(filename, source, languageVersion, true, ts.ScriptKind.TS)
      : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  const file = program.getSourceFile(filename);
  assert(file, "Virtual source file was not loaded");
  return { program, file };
}

function compound(node: ts.Statement): boolean {
  return ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isBlock(node) ||
    ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForInStatement(node) ||
    ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) ||
    ts.isTryStatement(node) || ts.isSwitchStatement(node) || ts.isWithStatement(node);
}

function statementGroups(statements: ts.NodeArray<ts.Statement>): ts.Statement[][] {
  const groups: ts.Statement[][] = [];
  let adjacent: ts.Statement[] = [];
  for (const statement of statements) {
    if (compound(statement)) {
      if (adjacent.length) groups.push(adjacent);
      adjacent = [];
      groups.push([statement]);
    } else {
      adjacent.push(statement);
    }
  }
  if (adjacent.length) groups.push(adjacent);
  return groups;
}

export function focusedProbe(raw: Buffer, path: string, parentName = "collectBatches", nestedName = "flush") {
  const source = raw.toString("utf8");
  assert(Buffer.from(source, "utf8").equals(raw), "Only exact UTF-8 input is supported by this probe");
  const { program, file } = analysisProgram(source, path);
  const syntax = program.getSyntacticDiagnostics(file);
  assert.equal(syntax.length, 0, "Source has syntax diagnostics: " +
    syntax.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("; "));
  const semantics = program.getSemanticDiagnostics(file);
  assert.equal(semantics.length, 0, "Fixture has semantic diagnostics: " +
    semantics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("; "));
  const parent = file.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === parentName);
  assert(parent?.body, `Missing parent function: ${parentName}`);
  const parentBody = parent.body;
  const nested = parentBody.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === nestedName);
  assert(nested?.body, `Missing nested function: ${nestedName}`);
  const range = (node: ts.Node): ByteSpan => [byteOffset(source, node.getStart(file)), byteOffset(source, node.end)];
  const lines = (node: ts.Node): [number, number] => [
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    file.getLineAndCharacterOfPosition(node.end - 1).line + 1,
  ];
  const groups = statementGroups(parent.body.statements);
  const first = groups[0]?.[0];
  const lastGroup = groups.at(-1);
  const last = lastGroup?.at(-1);
  assert(first && last, "Parent must contain statements");
  const parentSpan = range(parent);
  const bodyStart = byteOffset(source, first.getFullStart());
  const bodyEnd = byteOffset(source, last.end);
  const pieces = [raw.subarray(parentSpan[0], bodyStart)];
  const chunks = groups.map((group, index) => {
    const startNode = group[0];
    assert(startNode);
    const start = byteOffset(source, startNode.getFullStart());
    const next = groups[index + 1]?.[0];
    const end = next ? byteOffset(source, next.getFullStart()) : bodyEnd;
    const piece = raw.subarray(start, end);
    pieces.push(piece);
    return {
      kind: group.length === 1 ? ts.SyntaxKind[startNode.kind] : "statement_group",
      byte_span_half_open: [start, end] as ByteSpan,
      sha256: sha256(piece),
      bytes: piece.length,
      parent: parentName,
      statements: group.map((node) => ts.SyntaxKind[node.kind]),
    };
  });
  pieces.push(raw.subarray(bodyEnd, parentSpan[1]));
  assert(Buffer.concat(pieces).equals(raw.subarray(...parentSpan)), "Grouping lost original function bytes");
  for (let index = 1; index < chunks.length; index++) {
    assert.equal(chunks[index - 1]?.byte_span_half_open[1], chunks[index]?.byte_span_half_open[0], "Sibling gap or overlap");
  }

  const checker = program.getTypeChecker();
  const captures = new Map<ts.Symbol, { name: string; definition_byte_span_half_open: ByteSpan; occurrences: ByteSpan[] }>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const definition = symbol?.declarations?.find((declaration) =>
        (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration) || ts.isBindingElement(declaration)) &&
        declaration.pos >= parentBody.pos && declaration.end <= parentBody.end &&
        !(declaration.pos >= nested!.pos && declaration.end <= nested!.end));
      if (symbol && definition && "name" in definition && ts.isIdentifier(definition.name as ts.Node)) {
        const item = captures.get(symbol) ?? {
          name: symbol.getName(),
          definition_byte_span_half_open: range(definition.name as ts.Node),
          occurrences: [],
        };
        item.occurrences.push(range(node));
        captures.set(symbol, item);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(nested.body);
  const standaloneSource = source.slice(nested.getStart(file), nested.end);
  const standalone = analysisProgram(standaloneSource, join(ROOT, "fixtures/standalone-flush.ts"));
  const standaloneDiagnostics = [
    ...standalone.program.getSyntacticDiagnostics(standalone.file),
    ...standalone.program.getSemanticDiagnostics(standalone.file),
  ];
  const bindingDiagnostics = standaloneDiagnostics.filter((item) => item.code === 2304);
  const missingNames = [...new Set(bindingDiagnostics.map((item) =>
    standaloneSource.slice(item.start!, item.start! + item.length!)))].sort();
  return {
    path,
    parent: parentName,
    parent_lines: lines(parent),
    parent_byte_span_half_open: parentSpan,
    method: "Direct TypeScript compound statements and adjacent simple statements; no token tuning or LLM",
    groups: chunks,
    exact_byte_reconstruction: "PASS",
    sibling_body_ranges_contiguous: "PASS",
    full_file_typecheck_without_execution: "PASS",
    nested_function: {
      name: nestedName,
      lines: lines(nested),
      byte_span_half_open: range(nested),
      closure_symbols: [...captures.values()].sort((left, right) => left.name.localeCompare(right.name)),
      standalone_binding_probe: { type_checked: standaloneDiagnostics.length === 0, missing_names: missingNames },
    },
  };
}

export function runFixtureChecks() {
  const base = readFileSync(join(ROOT, "fixtures/batching.ts")).toString("utf8").replaceAll("\r\n", "\n");
  const variants = [
    ["utf8-lf", Buffer.from(base)],
    ["utf8-crlf", Buffer.from(base.replaceAll("\n", "\r\n"))],
    ["utf8-bom", Buffer.from("\ufeff" + base)],
  ] as const;
  const expected = ["batchNumber", "batches", "pending"].sort();
  const results = variants.map(([variant, raw]) => {
    const probe = focusedProbe(raw, join(ROOT, "fixtures/batching.ts"));
    assert.deepEqual(probe.nested_function.closure_symbols.map((item) => item.name).sort(), expected);
    assert.deepEqual(probe.nested_function.standalone_binding_probe.missing_names, expected);
    assert.equal(probe.groups.length, 4);
    return { variant, probe };
  });
  return {
    language: "typescript", analyzer_version: ts.version, fixture_variants: results,
    code_executed: false, llm_or_external_calls: false,
  };
}

if (isMain(import.meta.url)) {
  let output = join(ROOT, ".artifacts/chunking-probe-ts.json");
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--fixture") continue;
    assert(args[index] === "--output" && args[index + 1] && !args[index + 1]!.startsWith("--"),
      "Usage: npm run probe -- [--fixture] [--output path]");
    output = resolve(args[++index]!);
  }
  writeJson(output, runFixtureChecks());
  console.log(JSON.stringify({ artifact: output, mode: "typescript-fixture", checks: "PASS", code_executed: false }));
}
