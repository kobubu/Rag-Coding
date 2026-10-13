"""Offline structural probe; never imports or executes inspected source.

The default/--fixture mode is portable. --source-root reads an optional local
Portal Services checkout. This is a diagnostic example, not a full segmenter.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import symtable
import textwrap


ROOT = Path(__file__).resolve().parents[1]
DEFINITION_TYPES = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
COMPOUND_TYPES = (
    *DEFINITION_TYPES, ast.If, ast.For, ast.AsyncFor, ast.While,
    ast.With, ast.AsyncWith, ast.Try, ast.TryStar, ast.Match,
)


def line_span(node: ast.AST) -> list[int]:
    start = min([node.lineno, *[item.lineno for item in getattr(node, "decorator_list", [])]])
    return [start, node.end_lineno]


def file_metrics(path: Path) -> dict:
    raw = path.read_bytes()
    source = raw.decode("utf-8-sig")
    tree = ast.parse(source, filename=str(path))
    compile(source, str(path), "exec")
    definitions = [node for node in ast.walk(tree) if isinstance(node, DEFINITION_TYPES)]
    largest = sorted(definitions, key=lambda node: node.end_lineno - line_span(node)[0] + 1, reverse=True)[:5]
    return {
        "path": str(path), "sha256": hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw), "lines": len(raw.splitlines()),
        "definitions_including_nested": len(definitions),
        "full_file_compile_without_execution": "PASS",
        "largest_definitions": [
            {"name": node.name, "kind": type(node).__name__, "lines": line_span(node)}
            for node in largest
        ],
    }


def statement_groups(statements: list[ast.stmt]) -> list[list[ast.stmt]]:
    groups: list[list[ast.stmt]] = []
    adjacent: list[ast.stmt] = []
    for statement in statements:
        if isinstance(statement, COMPOUND_TYPES):
            if adjacent:
                groups.append(adjacent)
                adjacent = []
            groups.append([statement])
        else:
            adjacent.append(statement)
    if adjacent:
        groups.append(adjacent)
    return groups


def focused_probe(raw: bytes, path: str, parent_name: str, nested_name: str) -> dict:
    source = raw.decode("utf-8-sig")
    byte_lines = raw.splitlines(keepends=True)
    text_lines = source.splitlines(keepends=True)
    starts = [0]
    for line in byte_lines:
        starts.append(starts[-1] + len(line))
    tree = ast.parse(source, filename=path)
    compile(source, path, "exec")
    parent = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == parent_name)
    nested = next(node for node in parent.body if isinstance(node, ast.FunctionDef) and node.name == nested_name)
    groups = statement_groups(parent.body)
    parent_start, parent_end = starts[line_span(parent)[0] - 1], starts[parent.end_lineno]
    body_start = starts[line_span(groups[0][0])[0] - 1]
    chunks, pieces = [], [raw[parent_start:body_start]]
    for index, group in enumerate(groups):
        first_line = line_span(group[0])[0]
        next_line = line_span(groups[index + 1][0])[0] if index + 1 < len(groups) else parent.end_lineno + 1
        start, end = starts[first_line - 1], starts[next_line - 1]
        piece = raw[start:end]
        pieces.append(piece)
        chunks.append({
            "kind": type(group[0]).__name__ if len(group) == 1 else "statement_group",
            "lines": [first_line, next_line - 1], "byte_span_half_open": [start, end],
            "sha256": hashlib.sha256(piece).hexdigest(), "bytes": len(piece),
            "parent": parent.name, "statements": [type(item).__name__ for item in group],
        })
    if b"".join(pieces) != raw[parent_start:parent_end]:
        raise AssertionError("Grouping did not reconstruct the original function bytes")
    for left, right in zip(chunks, chunks[1:]):
        if left["byte_span_half_open"][1] != right["byte_span_half_open"][0]:
            raise AssertionError("Sibling groups have a gap or overlap")

    symbols = symtable.symtable(source, path, "exec")
    parent_scope = next(item for item in symbols.get_children() if item.get_name() == parent.name)
    nested_scope = next(item for item in parent_scope.get_children() if item.get_name() == nested.name)
    closure_symbols = [
        {"name": item.get_name(), "free": item.is_free(), "nonlocal": item.is_nonlocal(),
         "assigned": item.is_assigned(), "referenced": item.is_referenced()}
        for item in nested_scope.get_symbols() if item.is_free()
    ]
    standalone = textwrap.dedent("".join(text_lines[nested.lineno - 1:nested.end_lineno]))
    try:
        compile(standalone, "<standalone-nested-probe>", "exec")
    except SyntaxError as error:
        standalone_result = {"compiled": False, "error_type": "SyntaxError", "reason": error.msg}
    else:
        standalone_result = {"compiled": True}
    return {
        "path": path, "parent": parent.name, "parent_lines": line_span(parent),
        "method": "Direct AST compound statements and adjacent simple statements; no token tuning or LLM",
        "groups": chunks, "exact_byte_reconstruction": "PASS", "sibling_body_ranges_contiguous": "PASS",
        "nested_function": {
            "name": nested.name, "lines": line_span(nested),
            "closure_symbols": sorted(closure_symbols, key=lambda item: item["name"]),
            "module_references": sorted(item.get_name() for item in nested_scope.get_symbols()
                                        if item.is_global() and item.is_referenced()),
            "standalone_syntax_probe": standalone_result,
        },
    }


def run_fixture_checks() -> dict:
    path = ROOT / "fixtures" / "batching.py"
    base = path.read_bytes().replace(b"\r\n", b"\n")
    variants = {"utf8-lf": base, "utf8-crlf": base.replace(b"\n", b"\r\n"), "utf8-bom": b"\xef\xbb\xbf" + base}
    results = []
    for label, raw in variants.items():
        probe = focused_probe(raw, f"fixtures/batching.py:{label}", "collect_batches", "flush")
        captures = {item["name"] for item in probe["nested_function"]["closure_symbols"]}
        if captures != {"batch_number", "batches", "pending"}:
            raise AssertionError(f"Unexpected closure bindings: {captures}")
        standalone = probe["nested_function"]["standalone_syntax_probe"]
        if standalone["compiled"] or "nonlocal" not in standalone.get("reason", ""):
            raise AssertionError("Nested fixture must require its outer scope")
        results.append({"variant": label, "probe": probe})
    return {"fixture_variants": results, "code_executed": False, "llm_or_external_calls": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--fixture", action="store_true")
    mode.add_argument("--source-root", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / ".artifacts" / "chunking-probe.json")
    args = parser.parse_args()
    if args.source_root is None:
        result = run_fixture_checks()
    else:
        source_root = args.source_root.resolve()
        pks_root = source_root / "external" / "ProjectKnowledgeService" / "pks"
        files = [pks_root / "pipelines" / "scene_enrich.py", pks_root / "fact_admission.py", pks_root / "services" / "ingest.py"]
        revision = subprocess.run(["git", "-C", str(source_root), "rev-parse", "HEAD"],
                                  check=True, capture_output=True, text=True).stdout.strip()
        result = {
            "purpose": "Structural evidence only; no retrieval or runtime quality validation",
            "source_revision_observed": revision, "code_executed": False, "llm_or_external_calls": False,
            "files": [file_metrics(path) for path in files],
            "focused_probe": focused_probe(files[0].read_bytes(), str(files[0]), "plan_scene_windows", "flush"),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"artifact": str(args.output), "mode": "flashmt" if args.source_root else "fixture",
                      "checks": "PASS", "code_executed": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
