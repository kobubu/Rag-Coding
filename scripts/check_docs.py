"""Validate published documents, plan, contract examples and a structural fixture."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from jsonschema import Draft202012Validator

from probe_flashmt_chunking import run_fixture_checks
from render_backlog import render


ROOT = Path(__file__).resolve().parents[1]
IGNORED_PARTS = {".git", ".artifacts", ".venv", "__pycache__"}


def public_files(suffix: str) -> list[Path]:
    return sorted(path for path in ROOT.rglob("*" + suffix)
                  if not any(part in IGNORED_PARTS for part in path.relative_to(ROOT).parts)
                  and path != ROOT / "research" / "chunking-probe.json")


def walk_objects(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk_objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_objects(item)


def check_markdown() -> tuple[int, int]:
    checked_links = 0
    documents = public_files(".md")
    for path in documents:
        text = path.read_text(encoding="utf-8")
        if "\ufffd" in text:
            raise AssertionError(f"Replacement character in {path.relative_to(ROOT)}")
        if len(re.findall(r"^\s*```", text, flags=re.MULTILINE)) % 2:
            raise AssertionError(f"Unclosed code fence in {path.relative_to(ROOT)}")
        without_fences = re.sub(r"^\s*```[^\n]*\n.*?^\s*```[^\n]*$", "", text,
                                flags=re.MULTILINE | re.DOTALL)
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", without_fences):
            target = target.strip().strip("<>")
            parsed = urlsplit(target)
            if parsed.scheme in {"https", "http", "mailto"}:
                continue
            if parsed.scheme:
                raise AssertionError(f"Non-portable link in {path.relative_to(ROOT)}: {target}")
            resolved = (path.parent / unquote(parsed.path)).resolve() if parsed.path else path
            if not resolved.is_relative_to(ROOT) or not resolved.exists():
                raise AssertionError(f"Missing local target in {path.relative_to(ROOT)}: {target}")
            if parsed.fragment and resolved.suffix == ".md":
                headings = re.findall(r"^#+\s+(.+)$", resolved.read_text(encoding="utf-8"), flags=re.MULTILINE)
                anchors = {re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-") for heading in headings}
                if unquote(parsed.fragment) not in anchors:
                    raise AssertionError(f"Missing local anchor: {target}")
            checked_links += 1
    return len(documents), checked_links


def check_plan() -> dict:
    plan = json.loads((ROOT / "plans" / "backlog.json").read_text(encoding="utf-8"))
    tasks = plan["tasks"]
    by_id = {task["id"]: task for task in tasks}
    milestones = {item["id"]: item for item in plan["milestones"]}
    if len(by_id) != len(tasks) or len(milestones) != len(plan["milestones"]):
        raise AssertionError("Duplicate task or milestone IDs")
    for task in tasks:
        if not re.fullmatch(r"RC-\d{3}", task["id"]) or task["milestone"] not in milestones:
            raise AssertionError(f"Invalid task identity: {task['id']}")
        if task["status"] not in {"planned", "done", "blocked"} or task["size"] not in {"S", "M", "L"}:
            raise AssertionError(f"Invalid task status/size: {task['id']}")
        if not task["acceptance"] or not task["artifacts"] or not task["title"]:
            raise AssertionError(f"Incomplete task: {task['id']}")
        if len(set(task["depends_on"])) != len(task["depends_on"]):
            raise AssertionError(f"Duplicate dependency: {task['id']}")
        for dependency in task["depends_on"]:
            if dependency not in by_id or dependency == task["id"]:
                raise AssertionError(f"Unknown/self dependency: {task['id']} → {dependency}")
            if task["status"] == "done" and by_id[dependency]["status"] != "done":
                raise AssertionError(f"Done task has an unfinished prerequisite: {task['id']}")
    visited, active = set(), set()
    def visit(task_id: str) -> None:
        if task_id in active:
            raise AssertionError(f"Dependency cycle at {task_id}")
        if task_id in visited:
            return
        active.add(task_id)
        for dependency in by_id[task_id]["depends_on"]:
            visit(dependency)
        active.remove(task_id)
        visited.add(task_id)
    for task_id in by_id:
        visit(task_id)
    for milestone in milestones.values():
        members = [task for task in tasks if task["milestone"] == milestone["id"]]
        if not members or (milestone["status"] == "completed" and any(task["status"] != "done" for task in members)):
            raise AssertionError(f"Invalid milestone state: {milestone['id']}")
    if plan["mvp_through"] not in milestones:
        raise AssertionError("Unknown MVP milestone")
    if (ROOT / "plans" / "BACKLOG.md").read_text(encoding="utf-8") != render(plan):
        raise AssertionError("BACKLOG.md is stale; run python scripts/render_backlog.py")
    return {"tasks": len(tasks), "milestones": len(milestones),
            "done": sum(task["status"] == "done" for task in tasks)}


def check_contracts() -> int:
    schema = json.loads((ROOT / "contracts" / "core.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    for item in walk_objects(schema):
        if "$ref" in item:
            name = item["$ref"].removeprefix("#/$defs/")
            if item["$ref"] != "#/$defs/" + name or name not in schema["$defs"]:
                raise AssertionError(f"Unknown or external schema reference: {item['$ref']}")
    raw = (ROOT / "fixtures" / "batching.py").read_bytes()
    blob_hash = hashlib.sha256(raw).hexdigest()
    examples = sorted((ROOT / "contracts" / "examples").glob("*.json"))
    for path in examples:
        example = json.loads(path.read_text(encoding="utf-8"))
        name = example["schema"]
        if name not in schema["$defs"]:
            raise AssertionError(f"Unknown contract example: {name}")
        selected = {"$schema": schema["$schema"], "$defs": schema["$defs"], "$ref": "#/$defs/" + name}
        Draft202012Validator(selected).validate(example["value"])
        value = example["value"]
        for item in walk_objects(value):
            if {"file_version_id", "start_byte", "end_byte"}.issubset(item):
                if item["file_version_id"] != "blob:" + blob_hash or not 0 <= item["start_byte"] < item["end_byte"] <= len(raw):
                    raise AssertionError(f"Invalid fixture span in {path.name}")
                if item["line_start"] > item["line_end"]:
                    raise AssertionError(f"Invalid line range in {path.name}")
            if "source_hash" in item and item["source_hash"] != blob_hash:
                raise AssertionError(f"Wrong fixture hash in {path.name}")
        if name == "CodeUnit":
            span = value["source_span"]
            if hashlib.sha256(raw[span["start_byte"]:span["end_byte"]]).hexdigest() != value["content_hash"]:
                raise AssertionError("CodeUnit example does not match exact fixture bytes")
        if name == "ContextPackage" and value["tokens_used"] is not None and value["tokens_used"] > value["budget_tokens"]:
            raise AssertionError("ContextPackage exceeds its declared budget")
    if not examples:
        raise AssertionError("Missing contract examples")
    return len(examples)


def main() -> None:
    for path in public_files(".json"):
        json.loads(path.read_text(encoding="utf-8"))
    markdown_count, link_count = check_markdown()
    plan = check_plan()
    examples = check_contracts()
    fixture = run_fixture_checks()
    result = {"status": "PASS", "markdown_documents": markdown_count, "local_links": link_count,
              "plan": plan, "contract_examples": examples,
              "fixture_variants": len(fixture["fixture_variants"]),
              "limits": "Documentation and structural fixture only; no RAG quality or product runtime claim"}
    target = ROOT / ".artifacts" / "docs-check.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
