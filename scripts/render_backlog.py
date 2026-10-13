"""Render the canonical implementation plan as readable Markdown."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def render(plan: dict) -> str:
    lines = [
        "# Backlog реализации", "",
        "Представление автоматически собрано из [backlog.json](backlog.json). "
        "Изменять задачи следует в JSON и выполнять `python scripts/render_backlog.py`.", "",
        "`done` у документационных задач не означает готовность RAG-сервиса. "
        "Размер S/M/L обозначает относительную сложность, не срок.", "",
    ]
    for milestone in plan["milestones"]:
        lines.extend([
            f"## {milestone['id']}: {milestone['title']}", "",
            f"Критерий этапа: {milestone['gate']}", "",
        ])
        for task in (item for item in plan["tasks"] if item["milestone"] == milestone["id"]):
            dependencies = ", ".join(task["depends_on"]) or "нет"
            lines.extend([
                f"### {task['id']}: {task['title']}", "",
                f"Статус: **{task['status']}**. Приоритет: {task['priority']}. "
                f"Размер: {task['size']}. Зависимости: {dependencies}.", "",
                "Приёмка:", "",
                *[f"- {criterion}" for criterion in task["acceptance"]], "",
                "Ожидаемые материалы: " + ", ".join(f"`{item}`" for item in task["artifacts"]) + ".", "",
            ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    plan = json.loads((ROOT / "plans" / "backlog.json").read_text(encoding="utf-8"))
    target = ROOT / "plans" / "BACKLOG.md"
    expected = render(plan)
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != expected:
            raise SystemExit("BACKLOG.md is stale; run python scripts/render_backlog.py")
        print("BACKLOG_RENDER_OK")
    else:
        target.write_text(expected, encoding="utf-8", newline="\n")
        print("BACKLOG_WRITTEN")


if __name__ == "__main__":
    main()
