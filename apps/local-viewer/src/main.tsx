import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { MapData, MapNode, NodeInfo, SourceView, RelatedGraph, SymbolPage, Similarity } from "../../../src/local-agent/models";
import "./style.css";

type Context = { snapshot_id: string; bytes_used: number; omissions: number; parts: { path: string; span: { line_start: number }; text: string; reason: string }[] };
const labels: Record<string, string> = { calls: "вызывает", references: "использует", captures: "захватывает", contains: "содержит" };
async function api<T>(path: string, params: Record<string, string | number | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)]));
  const response = await fetch("/api/" + path + "?" + query, signal ? { signal } : {}), value = await response.json();
  if (!response.ok) throw Error(value.message ?? value.error ?? "Не удалось загрузить CM");
  return value as T;
}
function compact(value: number) { return new Intl.NumberFormat("ru", { notation: "compact", maximumFractionDigits: 1 }).format(value); }

function App() {
  const [map, setMap] = useState<MapData>(), [topic, setTopic] = useState<string>(), [selected, setSelected] = useState<MapNode>();
  const [query, setQuery] = useState(""), [results, setResults] = useState<Context>(), [searching, setSearching] = useState(false);
  const [source, setSource] = useState<SourceView>(), [symbols, setSymbols] = useState<SymbolPage>(), [symbolQuery, setSymbolQuery] = useState("");
  const [graph, setGraph] = useState<RelatedGraph>(), [similar, setSimilar] = useState<Similarity>(), [tab, setTab] = useState("symbols"), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 }), [edgeType, setEdgeType] = useState("all");
  const searchController = useRef<AbortController | null>(null), selectionController = useRef<AbortController | null>(null), drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<MapData>("map", {}, controller.signal).then(setMap).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => { controller.abort(); searchController.current?.abort(); selectionController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!map) return;
    const controller = new AbortController();let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;pending = true;
      api<{ snapshot_id: string }>("status", {}, controller.signal).then(async status => {
        if (status.snapshot_id === map.snapshot_id) return;
        const fresh = await api<MapData>("map", {}, controller.signal);
        if (controller.signal.aborted) return;
        searchController.current?.abort();selectionController.current?.abort();
        setMap(fresh);setSelected(undefined);setResults(undefined);setSource(undefined);setSymbols(undefined);setGraph(undefined);setSimilar(undefined);setBusy(false);setSearching(false);
        setError("Код изменился. Карта обновлена; выберите источник в новом снимке.");
      }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); }).finally(() => { pending = false; });
    }, 2000);
    return () => { controller.abort();window.clearInterval(timer); };
  }, [map?.snapshot_id]);
  async function select(node: MapNode | NodeInfo, line?: number) {
    if (!map) return;
    const file = map.nodes.find(file => file.path === node.path)!;
    if (!file) { setError("Источник не входит в текущую карту"); return; }
    selectionController.current?.abort(); const controller = new AbortController(); selectionController.current = controller;
    setSelected(file); setTopic(file.topic); setSimilar(undefined); setSource(undefined); setGraph(undefined); setSymbols(undefined); setSymbolQuery(""); setBusy(true); setError("");
    const isFile = node.id === file.id; setTab(isFile ? "symbols" : "code");
    try {
      const [code, glossary, connections] = await Promise.all([
        api<SourceView>("source", { id: node.id, snapshot: map.snapshot_id, line }, controller.signal),
        api<SymbolPage>("symbols", { path: file.path, snapshot: map.snapshot_id }, controller.signal),
        api<RelatedGraph>("graph", { id: node.id, snapshot: map.snapshot_id }, controller.signal),
      ]);
      if (!controller.signal.aborted) { setSource(code); setSymbols(glossary); setGraph(connections); if (line !== undefined) setTab("code"); }
    } catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function search() {
    if (!query.trim() || !map) return;
    searchController.current?.abort(); const controller = new AbortController(); searchController.current = controller; setSearching(true); setError("");
    try { const result = await api<Context>("search", { q: query, snapshot: map.snapshot_id }, controller.signal); if (!controller.signal.aborted) setResults(result); }
    catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  async function filterSymbols(offset = 0) {
    if (!map || !selected) return;
    selectionController.current?.abort();const controller = new AbortController();selectionController.current = controller;
    setBusy(true);
    try { const value = await api<SymbolPage>("symbols", { path: selected.path, q: symbolQuery, offset, snapshot: map.snapshot_id }, controller.signal);if (!controller.signal.aborted) setSymbols(value); }
    catch (reason) { if (!controller.signal.aborted) setError(String(reason)); } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function related() {
    if (!map || !source) return;
    selectionController.current?.abort();const controller = new AbortController();selectionController.current = controller;
    setBusy(true); setTab("similar");
    try { const value = await api<Similarity>("similar", { id: source.node.id, snapshot: map.snapshot_id }, controller.signal);if (!controller.signal.aborted) setSimilar(value); }
    catch (reason) { if (!controller.signal.aborted) setError(String(reason)); } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function nextSource() {
    if (!map || !source || source.next_byte === null) return;
    selectionController.current?.abort();const controller = new AbortController();selectionController.current = controller;
    setBusy(true);
    try { const value = await api<SourceView>("source", { id: source.node.id, byte_offset: source.next_byte, snapshot: map.snapshot_id }, controller.signal);if (!controller.signal.aborted) setSource(value); }
    catch (reason) { if (!controller.signal.aborted) setError(String(reason)); } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const visible = new Set(map?.nodes.filter(node => !topic || node.topic === topic).map(node => node.id));
  const nodes = new Map(map?.nodes.map(node => [node.id, node]));
  const shownEdges = map?.edges.filter(edge => (edgeType === "all" || edge.predicate === edgeType) && (!selected || edge.from === selected.id || edge.to === selected.id)) ?? [];
  const semanticPaths = new Set(similar?.matches.map(match => match.path));
  const fileCount = map?.topics.find(item => item.id === topic)?.files ?? map?.counts.files ?? 0;
  return <div className="app">
    <header className="topbar"><a href="/" className="brand" aria-label="CM Atlas"><span className="brand-mark">◇</span><span>CM <b>ATLAS</b><small>CODE MEMORY</small></span></a>
      <div className="project"><span className="live-dot"/> {map?.project_name ?? "Загрузка проекта"}<small>Локальный проект</small></div>
      <div className="header-meta"><span>Исходники на вашем компьютере</span><span className="badge">Только чтение</span></div></header>
    <section className="intro"><div><div className="eyebrow">ПРОЕКТ, КОТОРЫЙ МОЖНО ИССЛЕДОВАТЬ</div><h1>У каждой идеи есть место в коде.</h1><p>Находите области, раскрывайте связи и переходите к точному исходнику.</p></div>
      <div className="totals"><div><b>{compact(map?.counts.files ?? 0)}</b><span>модулей</span></div><div><b>{compact(map?.counts.symbols ?? 0)}</b><span>символов</span></div><div><b>{compact(map?.counts.relations ?? 0)}</b><span>связей</span></div></div></section>
    <div className="workspace">
      <nav className="areas" aria-label="Области проекта"><div className="panel-title">Области <span>{map?.topics.filter(item => item.files).length ?? 0}</span></div><button className={!topic ? "area active" : "area"} onClick={() => { setTopic(undefined); setSelected(undefined); }}>Весь проект <span>{map?.counts.files}</span></button>
        {map?.topics.filter(item => item.files).map(item => <button key={item.id} className={topic === item.id ? "area active" : "area"} onClick={() => { setTopic(item.id); setSelected(undefined); }}><i style={{ background: item.color }}/>{item.label}<span>{item.files}</span></button>)}
        <div className="area-note"><span>◇</span><p>Области предложены по именам и путям. Связи компилятора проверяются по исходнику.</p></div></nav>
      <main className="explorer"><form className="search" onSubmit={event => { event.preventDefault(); void search(); }}><span>⌕</span><input aria-label="Смысловой поиск" placeholder="Найти идею, функцию или зависимость…" value={query} onChange={event => setQuery(event.target.value)} maxLength={16000}/><button disabled={searching || !query.trim()}>{searching ? "Ищу…" : "Найти"}</button>{searching && <button type="button" className="cancel" onClick={() => { searchController.current?.abort(); setSearching(false); }}>Отмена</button>}</form>
        {error && <div role="alert" className="error">{error}<button onClick={() => window.location.reload()}>Обновить карту</button></div>}
        {results && <section className="search-results" aria-label="Результаты поиска"><div className="panel-title">Найденный контекст <span>{results.bytes_used.toLocaleString("ru")} байт</span><button onClick={() => setResults(undefined)} aria-label="Закрыть результаты">×</button></div>{results.parts.filter(part => part.reason === "match").map((part, position) => <button key={position} className="result" onClick={() => { const file = map?.nodes.find(node => node.path === part.path); if (file) void select(file, part.span.line_start); }}><b>{part.path}</b><small>строка {part.span.line_start}</small><code>{part.text.split("\n").slice(0, 2).join(" ").slice(0, 180)}</code></button>)}<p>Контекст частичный · пропущено диапазонов: {results.omissions}</p></section>}
        <div className="map-toolbar"><span><i className="live-dot"/>Карта модулей <small>{fileCount} в области</small></span><select aria-label="Тип связей" value={edgeType} onChange={event => setEdgeType(event.target.value)}><option value="all">Все структурные связи</option><option value="calls">Вызовы функций</option><option value="references">Использования символов</option><option value="captures">Захваты переменных</option></select></div>
        <div className="map-board"><svg className="world" viewBox="0 0 1800 1100" aria-label="Карта концептов проекта" onPointerDown={event => { if (event.target !== event.currentTarget && (event.target as Element).closest("[data-node], [data-topic]")) return; drag.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) setPan({ x: drag.current.startX + (event.clientX - drag.current.x) * 1.8, y: drag.current.startY + (event.clientY - drag.current.y) * 1.8 }); }} onPointerUp={() => { drag.current = null; }}>
          <defs><pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#74988b" opacity=".13"/></pattern><radialGradient id="sea"><stop stopColor="#1c3335"/><stop offset="1" stopColor="#101d23"/></radialGradient></defs><rect width="1800" height="1100" fill="url(#sea)"/><rect width="1800" height="1100" fill="url(#grid)"/>
          <g transform={`translate(${900 + pan.x} ${550 + pan.y}) scale(${zoom}) translate(-900 -550)`}>
            {map?.topics.filter(item => item.files).map(item => <g key={item.id} opacity={!topic || item.id === topic ? 1 : .22} data-topic={item.id} role="button" tabIndex={0} aria-label={item.label} onClick={() => setTopic(item.id)} onKeyDown={event => { if (event.key === "Enter") setTopic(item.id); }}><ellipse cx={item.x} cy={item.y} rx="250" ry="195" fill={item.color} opacity=".035"/><ellipse cx={item.x} cy={item.y} rx="210" ry="162" fill="none" stroke={item.color} opacity=".12" strokeDasharray="4 11"/><text x={item.x} y={item.y - 218} textAnchor="middle" fill={item.color} className="topic-label">{item.label}</text><text x={item.x} y={item.y - 195} textAnchor="middle" className="topic-count">{item.files} модулей · тема по именам</text></g>)}
            <g className="map-links">{shownEdges.map((edge, i) => { const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!; return <path key={i} d={`M${a.x},${a.y} Q${(a.x + b.x) / 2},${Math.min(a.y, b.y) - 80} ${b.x},${b.y}`} fill="none" stroke={edge.predicate === "calls" ? "#91d2bc" : "#8b9dba"} opacity={selected ? .65 : .10} strokeWidth={selected ? 2 : 1}/>; })}</g>
            {map?.nodes.map(node => { const area = map.topics.find(item => item.id === node.topic)!, active = selected?.id === node.id, semantic = semanticPaths.has(node.path); return <g key={node.id} data-node={node.id} role="button" tabIndex={0} aria-label={node.path} transform={`translate(${node.x} ${node.y})`} opacity={visible.has(node.id) ? 1 : .16} onClick={() => void select(node)} onKeyDown={event => { if (event.key === "Enter") void select(node); }}><title>{node.path} · {node.symbols} символов</title>{(active || semantic) && <circle r="23" fill="none" stroke={semantic ? "#c2a0ed" : area.color} strokeWidth="2" strokeDasharray={semantic ? "3 4" : undefined}/>}<circle r={active ? 12 : 7 + Math.min(5, Math.log2(node.symbols + 1) / 3)} fill={active ? "#f2f5e7" : area.color} stroke="#132229" strokeWidth="3"/>{active && <text y="43" textAnchor="middle" fill="#f2f5e7" className="node-label">{node.label}</text>}</g>; })}
          </g>
        </svg><div className="map-caption"><span className="compass">N<br/>✧</span><span>Связи раскрываются при выборе модуля</span></div><div className="zoom"><button aria-label="Увеличить карту" onClick={() => setZoom(Math.min(3, zoom + .25))}>+</button><button aria-label="Уменьшить карту" onClick={() => setZoom(Math.max(.5, zoom - .25))}>−</button><button aria-label="Сбросить масштаб" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⌂</button></div><div className="map-legend"><span><i/>Структурные связи</span><span><i className="semantic"/>Сходство кода</span></div></div>
        <div className="map-footer"><span>Снимок {map?.snapshot_id.slice(9, 19) ?? "…"}</span><span>{map?.omitted_edges ? `${map.omitted_edges} связей скрыто в обзоре` : "Точные связи доступны в карточках"}</span></div>
      </main>
      <aside className="inspector" aria-label="Навигация по коду">{!selected ? <div className="empty-inspector"><div className="empty-orbit">✦</div><span className="eyebrow">СЛЕДУЙТЕ ЗА СВЯЗЯМИ</span><h2>От идеи —<br/>к строке кода.</h2><p>Выберите область на карте, затем модуль. Здесь появятся символы, определения и доказательства связей.</p><div className="steps"><span>01 <b>Область</b></span><span>02 <b>Модуль</b></span><span>03 <b>Символ и исходник</b></span></div></div> : <><div className="inspector-head"><span className="eyebrow">ВЫБРАННЫЙ МОДУЛЬ</span><h2>{selected.label}</h2><p>{selected.path}</p><span className="source-badge">{selected.symbols} символов · проверенный снимок</span></div><div className="tabs" role="tablist">{[["symbols", "Символы"], ["code", "Код"], ["graph", "Связи"]].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key!)}>{label}</button>)}</div>{busy && <div className="loading" role="status">Загружаю источники…</div>}
        {tab === "symbols" && <div className="symbol-view"><form className="symbol-search" onSubmit={event => { event.preventDefault(); void filterSymbols(); }}><input aria-label="Поиск символа" placeholder="Функция, переменная, класс…" value={symbolQuery} onChange={event => setSymbolQuery(event.target.value)} maxLength={256}/><button>⌕</button></form><div className="symbol-list">{symbols?.symbols.map(symbol => <button key={symbol.id} onClick={() => void select(symbol)}><b>{symbol.name}</b><span>{symbol.kind} · {symbol.span.line_start}</span><small>{symbol.qualified_name}</small></button>)}</div><div className="pagination"><span>{symbols?.total ?? 0} символов</span>{symbols && symbols.offset > 0 && <button onClick={() => void filterSymbols(Math.max(0, symbols.offset - 100))}>Назад</button>}{symbols?.next_offset !== null && symbols?.next_offset !== undefined && <button onClick={() => void filterSymbols(symbols.next_offset!)}>Далее</button>}</div></div>}
        {tab === "code" && source && <div className="code-view"><div className="code-heading"><b>{source.node.name}</b><span>строки {source.span.line_start}–{source.span.line_end}</span></div><pre aria-label="Исходный код"><code>{source.text}</code></pre><div className="code-actions">{source.next_byte !== null && <button onClick={() => void nextSource()}>Следующий фрагмент →</button>}<button onClick={() => void related()}>Похожий код ↗</button></div><p className="muted">Источник привязан к снимку. Просмотр сохраняет точные UTF-8 диапазоны.</p></div>}
        {tab === "graph" && <div className="graph-view"><p className="muted">{graph?.truncated ? "Часть связей опущена. Раскройте конкретный символ." : "Факты компилятора · нажмите связь, чтобы увидеть доказательство."}</p>{graph?.edges.map(edge => { const a = graph.nodes.find(node => node.id === edge.from_id)!, b = graph.nodes.find(node => node.id === edge.to_id)!; return <div className="relation" key={edge.id}><button onClick={() => void select(a)}>{a.name}</button><span>{labels[edge.predicate]}</span><button onClick={() => void select(b)}>{b.name}</button><button className="evidence" onClick={() => { const file = map?.nodes.find(node => node.path === edge.evidence_path); if (file) void select(file, edge.evidence.line_start); }}>Источник: {edge.evidence_path.split("/").at(-1)}:{edge.evidence.line_start} ↗</button></div>; })}</div>}
        {tab === "similar" && <div className="similar-view"><div className="similar-title">Похожий код <span>Смысловое сходство</span></div><p className="muted">Близость embeddings — кандидатная связь. Она не означает вызов функции.</p>{similar?.matches.map(match => <button key={match.id} onClick={() => void select(match)}><b>{match.name}</b><small>{match.path}</small><span>{(match.score * 100).toFixed(1)}% cosine</span></button>)}</div>}</>}
      </aside>
    </div><footer className="app-footer"><span>CM — Code Memory</span><span>Локальная навигация · индекс и векторы остаются на устройстве</span></footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
