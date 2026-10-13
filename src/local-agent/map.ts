import { basename } from "node:path";
import type { CMIndex } from "../code-memory/types.js";
import type { MapData, MapEdge, MapNode, Topic } from "./models.js";

const TOPICS = [
  { id: "interface", label: "Интерфейс и сцены", x: 360, y: 280, color: "#6fcbb2", pattern: /render|visual|scene|camera|canvas|shader|sprite|paint|menu|hud|screen|layout|map/ },
  { id: "runtime", label: "Движение и логика", x: 820, y: 250, color: "#adc776", pattern: /physics|collision|depth|route|level|movement|obstacle|flight|jump|input|control|combat/ },
  { id: "rewards", label: "Реклама и награды", x: 1320, y: 310, color: "#e9ae74", pattern: /reward|advert|(?:^|[\/_-])ads?(?:[\/_\.-]|$)|monet|purchase|payment|economy|wallet|coin|balance/ },
  { id: "data", label: "Данные и память", x: 1100, y: 780, color: "#b0a0e0", pattern: /save|storage|persist|database|memory|index|vector|retriev|ledger|content|record/ },
  { id: "integration", label: "Связь с платформой", x: 540, y: 820, color: "#79b7d8", pattern: /platform|native|adapter|network|client|server|api|mcp|harness|auth|bridge|localization/ },
  { id: "tools", label: "Инструменты и проверки", x: 1550, y: 800, color: "#d6a9b6", pattern: /test|check|probe|script|tool|build|bench|optim/ },
  { id: "other", label: "Общая структура", x: 245, y: 690, color: "#91a9a5", pattern: /./ },
] as const;

export function mapProjection(index: CMIndex, projectName: string): MapData {
  const topics: Topic[] = TOPICS.map(({ pattern: _pattern, ...topic }) => ({ ...topic, files: 0, basis: "names-and-paths" }));
  const symbolCounts = new Map<string, number>();
  for (const symbol of index.symbols) symbolCounts.set(symbol.path, (symbolCounts.get(symbol.path) ?? 0) + 1);
  const fileUnits = new Map(index.units.filter(unit => unit.kind === "file").map(unit => [unit.path, unit]));
  const buckets = new Map(topics.map(topic => [topic.id, [] as typeof index.files]));
  for (const file of index.files) {
    const words = file.path.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const topic = TOPICS.find(candidate => candidate.pattern.test(words))!;
    buckets.get(topic.id)!.push(file);
  }
  const nodes: MapNode[] = [];
  for (const topic of topics) {
    const files = buckets.get(topic.id)!.sort((a, b) => a.path.localeCompare(b.path));
    topic.files = files.length;
    const radius = Math.min(225, 60 + Math.sqrt(files.length) * 18);
    for (const [position, file] of files.entries()) {
      const angle = position * 2.399963229728653, distance = radius * Math.sqrt((position + .5) / files.length);
      nodes.push({ id: fileUnits.get(file.path)!.id, label: basename(file.path), path: file.path, topic: topic.id,
        x: topic.x + Math.cos(angle) * distance, y: topic.y + Math.sin(angle) * distance, symbols: symbolCounts.get(file.path) ?? 0 });
    }
  }
  const paths = new Map([...index.units, ...index.symbols].map(node => [node.id, node.path]));
  const edges = new Map<string, MapEdge>();
  for (const relation of index.relations) {
    const from = fileUnits.get(paths.get(relation.from_id)!)?.id, to = fileUnits.get(paths.get(relation.to_id)!)?.id;
    if (!from || !to || from === to) continue;
    const key = from + "\0" + to + "\0" + relation.predicate;
    const edge = edges.get(key);
    if (edge) edge.count++;
    else edges.set(key, { from, to, predicate: relation.predicate, count: 1, evidence_id: relation.id, status: "compiler-fact" });
  }
  const ordered = [...edges.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
  return { snapshot_id: index.snapshot_id, project_name: projectName, topics, nodes, edges: ordered.slice(0, 1000), omitted_edges: Math.max(0, ordered.length - 1000),
    counts: { files: index.files.length, symbols: index.symbols.length, units: index.units.length, relations: index.relations.length }, concept_method: "inferred-from-names-and-paths" };
}
