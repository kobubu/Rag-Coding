import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { ANALYSIS_FILES, byteOffset, CMError, hash, inside, snapshotId, utf8 } from "./source.js";
import type { CMFile, CMIndex, CMRelation, CMSymbol, CMUnit, Predicate, SourceSpan } from "./types.js";

const IGNORED = new Set([".git", "node_modules", "dist", ".artifacts", ".code-memory", ".venv"]);
const MAX_FILES = 500;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

function scan(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (IGNORED.has(entry.name) || entry.isSymbolicLink()) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scan(root, path);
    return entry.isFile() && /\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !/\.d\.(?:ts|mts|cts)$/.test(entry.name) ? [path] : [];
  }).sort();
}

function callable(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}

function isCompound(node: ts.Statement): boolean {
  return ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isBlock(node) || ts.isIfStatement(node) ||
    ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) ||
    ts.isDoStatement(node) || ts.isTryStatement(node) || ts.isSwitchStatement(node);
}

function groups(statements: ts.NodeArray<ts.Statement>): ts.Statement[][] {
  const result: ts.Statement[][] = [];
  let adjacent: ts.Statement[] = [];
  for (const statement of statements) {
    if (isCompound(statement)) {
      if (adjacent.length) result.push(adjacent);
      adjacent = [];
      result.push([statement]);
    } else adjacent.push(statement);
  }
  if (adjacent.length) result.push(adjacent);
  return result;
}

function declarationName(node: ts.Node): ts.Identifier | undefined {
  if (!(ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
    ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node))) return undefined;
  return node.name && ts.isIdentifier(node.name) ? node.name : undefined;
}

export function buildIndex(projectRoot: string, paths?: string[]): CMIndex {
  const root = realpathSync(projectRoot);
  const analysisInputs = ANALYSIS_FILES.filter((path) => existsSync(join(root, path))).map((path) => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  const names = paths ? paths.map((path) => resolve(root, path)).sort() : scan(root);
  if (names.length === 0 || names.length > MAX_FILES || new Set(names).size !== names.length) {
    throw new CMError("corpus_limit", `Expected 1..${MAX_FILES} distinct source files`);
  }
  const rawByName = new Map<string, Buffer>();
  const files: CMFile[] = [];
  let totalBytes = 0;
  for (const filename of names) {
    if (!inside(root, realpathSync(filename))) throw new CMError("source_outside_project", filename);
    const raw = readFileSync(filename);
    totalBytes += raw.length;
    if (totalBytes > MAX_SOURCE_BYTES) throw new CMError("corpus_limit", "Source corpus exceeds 8 MiB");
    rawByName.set(filename, raw);
    files.push({ path: relative(root, filename).split(sep).join("/"), sha256: hash(raw), source: utf8(raw) });
  }
  const defaults: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, skipLibCheck: true, types: [] };
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  let options = defaults;
  if (configPath && inside(root, configPath)) {
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new CMError("invalid_tsconfig", ts.flattenDiagnosticMessageText(config.error.messageText, " "));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    if (parsed.errors.length) throw new CMError("invalid_tsconfig", parsed.errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("; "));
    options = { ...parsed.options, noEmit: true, skipLibCheck: true };
  }
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    const raw = rawByName.get(resolve(filename));
    return raw ? ts.createSourceFile(filename, utf8(raw), languageVersion, true) : original(filename, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram(names, options, host);
  const checker = program.getTypeChecker();
  const units: CMUnit[] = [];
  const symbols: CMSymbol[] = [];
  const relations: CMRelation[] = [];
  const diagnostics: CMIndex["diagnostics"] = [];
  const unitNodes = new Map<ts.Node, CMUnit>();
  const symbolByCompiler = new Map<ts.Symbol, CMSymbol>();
  const declarationNames = new Set<ts.Node>();
  const fileRecords = new Map(files.map((file) => [resolve(root, file.path), file]));
  const span = (file: ts.SourceFile, start: number, end: number): SourceSpan => {
    const record = fileRecords.get(resolve(file.fileName))!;
    return { file_version_id: "blob:" + record.sha256, start_byte: byteOffset(record.source, start),
      end_byte: byteOffset(record.source, end), line_start: file.getLineAndCharacterOfPosition(start).line + 1,
      line_end: file.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line + 1 };
  };
  const unitFor = (node: ts.Node | undefined): CMUnit | undefined => {
    while (node) { const unit = unitNodes.get(node); if (unit) return unit; node = node.parent; }
    return undefined;
  };
  const addRelation = (from: string, to: string, predicate: Predicate, evidence: SourceSpan) => {
    const id = "relation:" + hash(`${from}:${to}:${predicate}:${evidence.file_version_id}:${evidence.start_byte}`).slice(0, 24);
    relations.push({ id, from_id: from, to_id: to, predicate, evidence });
  };
  for (const filename of names) {
    const file = program.getSourceFile(filename)!;
    const record = fileRecords.get(filename)!;
    const syntax = program.getSyntacticDiagnostics(file);
    const semantic = program.getSemanticDiagnostics(file);
    for (const item of [...syntax, ...semantic].slice(0, 30)) diagnostics.push({ path: record.path, code: item.code,
      message: ts.flattenDiagnosticMessageText(item.messageText, " ") });
    const rootUnit: CMUnit = { id: "unit:" + hash(record.path + ":file").slice(0, 24), path: record.path,
      name: record.path, kind: "file", parent_id: null, span: span(file, 0, record.source.length), required_symbol_ids: [] };
    units.push(rootUnit);
    unitNodes.set(file, rootUnit);
    if (syntax.length) continue;
    function visit(node: ts.Node): void {
      const isType = ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node);
      if (callable(node) || isType) {
        const start = node.getStart(file);
        const owner = unitFor(node.parent)!;
        const declared = "name" in node ? (node.name as ts.Node | undefined)?.getText(file) : undefined;
        const assigned = ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(file) : undefined;
        const unit: CMUnit = { id: "unit:" + hash(`${record.path}:${start}:${node.end}`).slice(0, 24), path: record.path,
          name: declared ?? assigned ?? `anonymous@${file.getLineAndCharacterOfPosition(start).line + 1}`,
          kind: isType ? "type" : ts.isMethodDeclaration(node) ? "method" : "function", parent_id: owner.id,
          span: span(file, start, node.end), required_symbol_ids: [] };
        units.push(unit);
        unitNodes.set(node, unit);
        addRelation(owner.id, unit.id, "contains", unit.span);
        if (callable(node) && node.body && ts.isBlock(node.body)) {
          const partition = groups(node.body.statements);
          partition.forEach((group, index) => {
            const first = group[0]!;
            const last = group.at(-1)!;
            const next = partition[index + 1]?.[0];
            const groupSpan = span(file, first.getFullStart(), next ? next.getFullStart() : last.end);
            const block: CMUnit = { id: "unit:" + hash(`${record.path}:block:${groupSpan.start_byte}:${groupSpan.end_byte}`).slice(0, 24),
              path: record.path, name: `${unit.name}/block-${index + 1}`, kind: "block", parent_id: unit.id,
              span: groupSpan, required_symbol_ids: [] };
            units.push(block);
            addRelation(unit.id, block.id, "contains", groupSpan);
          });
        }
      }
      const name = declarationName(node);
      if (name) {
        declarationNames.add(name);
        const compilerSymbol = checker.getSymbolAtLocation(name);
        const owner = unitFor(node)!;
        const nameSpan = span(file, name.getStart(file), name.end);
        let declaration: ts.Node = node;
        if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) declaration = node.parent.parent;
        const symbol: CMSymbol = { id: "symbol:" + hash(`${record.path}:${nameSpan.start_byte}:${name.text}`).slice(0, 24),
          name: name.text, qualified_name: `${record.path}::${owner.name}::${name.text}`, path: record.path,
          kind: ts.isParameter(node) ? "parameter" : ts.isFunctionDeclaration(node) ? "function" :
            ts.isMethodDeclaration(node) ? "method" : isType || ts.isTypeAliasDeclaration(node) ? "type" : "variable",
          span: nameSpan, declaration_span: span(file, declaration.getStart(file), declaration.end), owner_unit_id: owner.id };
        symbols.push(symbol);
        if (compilerSymbol && !symbolByCompiler.has(compilerSymbol)) symbolByCompiler.set(compilerSymbol, symbol);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  for (const filename of names) {
    const file = program.getSourceFile(filename)!;
    if (program.getSyntacticDiagnostics(file).length) continue;
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node) && !declarationNames.has(node)) {
        let compilerSymbol = checker.getSymbolAtLocation(node);
        if (compilerSymbol && compilerSymbol.flags & ts.SymbolFlags.Alias) {
          const resolved = checker.getAliasedSymbol(compilerSymbol);
          if (symbolByCompiler.has(resolved)) compilerSymbol = resolved;
        }
        const target = compilerSymbol && symbolByCompiler.get(compilerSymbol);
        const owner = unitFor(node);
        if (target && owner) {
          const occurrence = span(file, node.getStart(file), node.end);
          const called = ts.isCallExpression(node.parent) && node.parent.expression === node ||
            ts.isPropertyAccessExpression(node.parent) && node.parent.name === node && ts.isCallExpression(node.parent.parent) &&
            node.parent.parent.expression === node.parent;
          addRelation(owner.id, target.id, called ? "calls" : "references", occurrence);
          const containing = units.filter((unit) => unit.path === owner.path && unit.kind !== "file" &&
            unit.span.start_byte <= occurrence.start_byte && unit.span.end_byte >= occurrence.end_byte);
          for (const unit of containing) {
            if (target.path !== unit.path || target.span.start_byte < unit.span.start_byte || target.span.end_byte > unit.span.end_byte) {
              if (!unit.required_symbol_ids.includes(target.id)) unit.required_symbol_ids.push(target.id);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  for (const unit of units) {
    unit.required_symbol_ids.sort();
    if (unit.kind === "function" || unit.kind === "method") {
      for (const id of unit.required_symbol_ids) {
        const symbol = symbolById.get(id)!;
        const symbolOwner = units.find((candidate) => candidate.id === symbol.owner_unit_id)!;
        if (symbol.path === unit.path && symbolOwner.kind !== "file" && symbolOwner.span.start_byte <= unit.span.start_byte &&
          symbolOwner.span.end_byte >= unit.span.end_byte) {
          const occurrence = relations.find((relation) => relation.from_id === unit.id && relation.to_id === id)?.evidence;
          addRelation(unit.id, id, "captures", occurrence ?? symbol.span);
        }
      }
    }
  }
  for (const filename of names) {
    if (!readFileSync(filename).equals(rawByName.get(filename)!)) throw new CMError("source_changed_during_index", filename);
  }
  for (const input of analysisInputs) {
    if (hash(readFileSync(join(root, input.path))) !== input.sha256) throw new CMError("source_changed_during_index", input.path);
  }
  const configHash = hash(JSON.stringify({ options, analysisInputs }));
  return { format: "code-memory-0.1", snapshot_id: snapshotId(files, ts.version, configHash), analysis_config_hash: configHash, analysis_inputs: analysisInputs,
    analyzer: { name: "typescript-compiler", version: ts.version },
    capabilities: ["typescript_syntax", "compiler_symbol_bindings", "function_units", "direct_statement_groups", "references", "calls", "lexical_captures"],
    files, units, symbols, relations, diagnostics,
    limits: ["Local immutable JSON index; PostgreSQL and vectors are not implemented", "No full dataflow, dynamic-call resolution or LLM enrichment",
      "Only selected TypeScript files are indexed; compiler diagnostics report incomplete semantics"] };
}
