import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain, readJson, ROOT } from "./lib.js";

export interface Task {
  id: string;
  milestone: string;
  title: string;
  status: "planned" | "done" | "blocked";
  priority: string;
  size: "S" | "M" | "L";
  depends_on: string[];
  acceptance: string[];
  artifacts: string[];
}

export interface Plan {
  schema_version: string;
  as_of: string;
  mvp_through: string;
  milestones: { id: string; title: string; gate: string; status: string }[];
  tasks: Task[];
}

export function render(plan: Plan): string {
  const lines = [
    "# Backlog реализации", "",
    "Представление автоматически собрано из [backlog.json](backlog.json). " +
    "Изменять задачи следует в JSON и выполнять `npm run backlog` после сборки.", "",
    "`done` у документационных задач не означает готовность RAG-сервиса. " +
    "Размер S/M/L обозначает относительную сложность, не срок.", "",
  ];
  for (const milestone of plan.milestones) {
    lines.push(`## ${milestone.id}: ${milestone.title}`, "", `Критерий этапа: ${milestone.gate}`, "");
    for (const task of plan.tasks.filter((item) => item.milestone === milestone.id)) {
      const dependencies = task.depends_on.join(", ") || "нет";
      lines.push(
        `### ${task.id}: ${task.title}`, "",
        `Статус: **${task.status}**. Приоритет: ${task.priority}. ` +
        `Размер: ${task.size}. Зависимости: ${dependencies}.`, "",
        "Приёмка:", "",
        ...task.acceptance.map((criterion) => `- ${criterion}`), "",
        "Ожидаемые материалы: " + task.artifacts.map((item) => `\`${item}\``).join(", ") + ".", "",
      );
    }
  }
  return lines.join("\n");
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === "--check"), "Usage: npm run backlog -- [--check]");
  const expected = render(readJson<Plan>(join(ROOT, "plans/backlog.json")));
  const target = join(ROOT, "plans/BACKLOG.md");
  if (args.includes("--check")) {
    assert.equal(readFileSync(target, "utf8"), expected, "BACKLOG.md is stale; run npm run backlog");
    console.log("BACKLOG_RENDER_OK");
  } else {
    writeFileSync(target, expected, "utf8");
    console.log("BACKLOG_WRITTEN");
  }
}
