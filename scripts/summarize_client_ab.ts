import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const LABEL = process.argv[2] ?? "20261015-main";
if (!/^[a-z0-9-]+$/.test(LABEL)) throw Error("Invalid experiment label");
const OUTPUT = join(ROOT, ".artifacts/client-ab-" + LABEL), PUBLIC = join(ROOT, "evaluation/clients", LABEL.includes("fixed") ? "fixed" : LABEL.includes("guided") ? "guided" : "");
type Run = { client: string; task: string; category: string; rep: number; arm: string; run: string; elapsed_ms: number; setup_ms: number; grade_ms: number; success: boolean; completed: boolean; timed_out: boolean; regressions: boolean; cm_calls: number; usage: any; native_usage: any; quality: any; scope_changes: string[]; calls: any[]; resolved_models?: string[] };
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => { const sorted = [...xs].sort((a, b) => a - b), n = sorted.length; return n ? (sorted[Math.floor(n / 2)]! + sorted[Math.floor((n - 1) / 2)]!) / 2 : 0; };
export function summarizeClientRuns(runs: Run[]) {
  const group = (arm: string) => {
    const selected = runs.filter(r => r.arm === arm);
    const passed = selected.filter(r => r.success).length, seconds = sum(selected.map(r => r.elapsed_ms)) / 1000, tokens = sum(selected.map(r => r.usage.total));
    return { n: selected.length, passed, behavior_passed: selected.filter(r => r.quality.pass).length, regressions_passed: selected.filter(r => r.regressions).length, total_tokens: tokens, input_tokens: sum(selected.map(r => r.usage.input)), output_tokens: sum(selected.map(r => r.usage.output)), cache_read: sum(selected.map(r => r.usage.cache_read)), cache_write: sum(selected.map(r => r.usage.cache_write)), missing_usage: sum(selected.map(r => r.usage.missing)), agent_seconds: seconds, mean_agent_seconds: seconds / Math.max(1, selected.length), median_agent_seconds: median(selected.map(r => r.elapsed_ms)) / 1000, checked_seconds: sum(selected.map(r => r.elapsed_ms + r.grade_ms + r.setup_ms)) / 1000, amortized_seconds_per_pass: passed ? seconds / passed : null, amortized_tokens_per_pass: passed ? tokens / passed : null, list_price_estimate_usd: sum(selected.map(r => r.usage.usd_estimate ?? 0)), cm_calls: sum(selected.map(r => r.cm_calls)), cm_adoption: selected.filter(r => r.cm_calls > 0).length, timeouts: selected.filter(r => r.timed_out).length };
  };
  const none = group("none"), cm = group("cm"), pairs = runs.filter(r => r.arm === "none").flatMap(a => { const b = runs.find(r => r.arm === "cm" && r.task === a.task && r.rep === a.rep); return b ? [{ task: a.task, rep: a.rep, none: a, cm: b }] : []; });
  const differences = { token_change_pct: (cm.total_tokens / none.total_tokens - 1) * 100, agent_time_change_pct: (cm.agent_seconds / none.agent_seconds - 1) * 100, checked_time_change_pct: (cm.checked_seconds / none.checked_seconds - 1) * 100, price_change_pct: (cm.list_price_estimate_usd / none.list_price_estimate_usd - 1) * 100, paired_time_wins: pairs.filter(p => p.cm.elapsed_ms < p.none.elapsed_ms).length, paired_token_wins: pairs.filter(p => p.cm.usage.total < p.none.usage.total).length, paired_quality_wins: pairs.filter(p => p.cm.success && !p.none.success).length, paired_quality_losses: pairs.filter(p => !p.cm.success && p.none.success).length, pairs: pairs.length };
  let state = 217391; const rnd = () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296), tasks = [...new Set(pairs.map(p => p.task))];
  const tokenSamples: number[] = [], timeSamples: number[] = [];
  if (tasks.length) for (let i = 0; i < 10000; i++) { const sample = tasks.flatMap(() => { const task = tasks[Math.floor(rnd() * tasks.length)]!; return pairs.filter(p => p.task === task); }); tokenSamples.push((sum(sample.map(p => p.cm.usage.total)) / sum(sample.map(p => p.none.usage.total)) - 1) * 100); timeSamples.push((sum(sample.map(p => p.cm.elapsed_ms)) / sum(sample.map(p => p.none.elapsed_ms)) - 1) * 100); }
  const ci = (values: number[]) => { values.sort((a, b) => a - b); return values.length ? [values[Math.floor(values.length * .025)], values[Math.floor(values.length * .975)]] : []; };
  const later = pairs.slice(1);
  return { none, cm, differences, without_first_pair: { pairs: later.length, token_change_pct: (sum(later.map(p => p.cm.usage.total)) / sum(later.map(p => p.none.usage.total)) - 1) * 100, agent_time_change_pct: (sum(later.map(p => p.cm.elapsed_ms)) / sum(later.map(p => p.none.elapsed_ms)) - 1) * 100 }, task_cluster_bootstrap_95pct: { tokens: ci(tokenSamples), agent_time: ci(timeSamples), method: "10000 task-cluster resamples; both repetitions remain paired; six task clusters, bounded exploratory uncertainty" }, per_task: tasks.map(task => { const ps = pairs.filter(p => p.task === task); return { task, pairs: ps.length, none_tokens: sum(ps.map(p => p.none.usage.total)), cm_tokens: sum(ps.map(p => p.cm.usage.total)), none_seconds: sum(ps.map(p => p.none.elapsed_ms)) / 1000, cm_seconds: sum(ps.map(p => p.cm.elapsed_ms)) / 1000, none_passed: ps.filter(p => p.none.success).length, cm_passed: ps.filter(p => p.cm.success).length, cm_calls: sum(ps.map(p => p.cm.cm_calls)) }; }) };
}
function toolAudit(run: Run) {
  const path = join(OUTPUT, "runs", run.run, "events.jsonl"), events = readFileSync(path, "utf8").split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const errors: string[] = []; let payloadBytes = 0, builtinCalls = 0, readShellCalls = 0, nonzeroShellCalls = 0, partialContexts = 0;
  const routes: string[] = [];
  const channels = new Set<string>(); let visibleSourceResults = 0, metadataOnlyResults = 0;
  const inspectContext = (raw: string) => { for (const route of new Set([...raw.matchAll(/Route:\s*([a-z0-9_/-]+)/gi)].map(m => m[1]!))) routes.push(route); };
  const toolNames = new Map<string, string>();
  for (const e of events) {
    if (e.type === "item.completed") {
      if (e.item?.type === "command_execution" || e.item?.type === "file_change") builtinCalls++;
      if (e.item?.type === "command_execution") { if (/Get-Content|readFile/.test(e.item.command)) readShellCalls++; if (e.item.exit_code) nonzeroShellCalls++; }
      if (e.item?.type === "mcp_tool_call") { const result = e.item.result; for (const channel of (result?.structured_content ?? result?.structuredContent)?.channels ?? []) channels.add(channel); payloadBytes += Buffer.byteLength(JSON.stringify(result ?? {})); for (const part of result?.content ?? []) { const category = part.type === "text" ? part.text.match(/CMError: ([a-z_]+)/)?.[1] : undefined; if (category) errors.push(category); if (part.type === "text") { inspectContext(part.text); if (/CM context \(partial/.test(part.text)) partialContexts++; } } }
    }
    if (e.type === "assistant") for (const c of e.message?.content ?? []) if (c.type === "tool_use") { toolNames.set(c.id, c.name); if (!c.name.startsWith("mcp__")) builtinCalls++; }
    if (e.type === "user") for (const c of e.message?.content ?? []) if (c.type === "tool_result") { const raw = typeof c.content === "string" ? c.content : JSON.stringify(c.content); if (toolNames.get(c.tool_use_id)?.startsWith("mcp__")) { payloadBytes += Buffer.byteLength(raw ?? ""); inspectContext(raw ?? ""); if (/CM context \(partial/.test(raw ?? "")) partialContexts++; } const category = raw?.match(/CMError: ([a-z_]+)/)?.[1]; if (category) errors.push(category); }
    if (e.type === "user") for (const c of e.message?.content ?? []) if (c.type === "tool_result" && toolNames.get(c.tool_use_id)?.endsWith("cm_retrieve_context") && typeof c.content === "string") {
      try { const parsed = JSON.parse(c.content); for (const channel of parsed.channels ?? []) channels.add(channel); if (parsed.bytes_used > 0) { if (typeof parsed.source_context === "string" && parsed.source_context.length) visibleSourceResults++; else metadataOnlyResults++; } } catch {}
    }
  }
  const initialization = events.find(e => e.type === "system" && e.subtype === "init");
  const stderr = readFileSync(join(OUTPUT, "runs", run.run, "stderr.txt"), "utf8");
  return { builtin_calls: builtinCalls, provider_response_calls: run.calls.filter(c => c.endpoint === "v1/responses").length, native_claude_turns: events.find(e => e.type === "result")?.num_turns ?? null, read_shell_calls: readShellCalls, nonzero_shell_calls: nonzeroShellCalls, partial_cm_contexts: partialContexts, cm_routes: routes, cm_channels: [...channels], claude_model_visible_source_results: visibleSourceResults, claude_metadata_only_results: metadataOnlyResults, mcp_payload_bytes: payloadBytes, mcp_payload_measurement: run.client === "claude" ? "model-visible message tool_result" : "native event result, both representations", cm_errors: errors, claude_cm_connected: initialization ? Boolean(initialization.mcp_servers?.some((s: any) => s.name === "cm_eval" && s.status === "connected")) : null, claude_cm_skill_discovered: initialization ? Boolean(initialization.skills?.includes("code-memory")) : null, cm_startup_error_lines: stderr.split("\n").filter(line => /cm_eval/i.test(line) && /fail|error|timed out/i.test(line)).map(line => line.slice(0, 300)) };
}
if (process.argv[1]?.endsWith("summarize_client_ab.js")) {
  const protocol = read(join(OUTPUT, "protocol.json")), runs: Run[] = ["codex", "claude"].flatMap(client => existsSync(join(OUTPUT, "results-" + client + ".json")) ? read(join(OUTPUT, "results-" + client + ".json")) : []), clients = Object.fromEntries(["codex", "claude"].filter(client => runs.some(r => r.client === client)).map(client => [client, summarizeClientRuns(runs.filter(r => r.client === client))]));
  const safe = runs.map(r => ({ client: r.client, model: r.client === "codex" ? protocol.model.codex : protocol.model.claude, task: r.task, category: r.category, repetition: r.rep, arm: r.arm, agent_seconds: r.elapsed_ms / 1000, setup_seconds: r.setup_ms / 1000, grader_seconds: r.grade_ms / 1000, tokens: r.usage, passed: r.success, behavior_passed: r.quality.pass, behavior_checks: r.quality.checks ?? null, failure_category: r.quality.error?.split("\n")[0] ?? (r.success ? null : "Client/regression/scope failure"), cpu: r.quality.cpu ?? null, regressions_passed: r.regressions, completed: r.completed, timed_out: r.timed_out, scope_changes: r.scope_changes, cm_calls: r.cm_calls, ...toolAudit(r) }));
  const planned = protocol.task_count * protocol.repetitions * 2 * protocol.clients.length;
  mkdirSync(PUBLIC, { recursive: true }); writeFileSync(join(PUBLIC, "results.json"), JSON.stringify({ format: "cm-native-clients-ab-results-1", generated_at: new Date().toISOString(), complete: runs.length === planned, planned_runs: planned, cm_version: protocol.cm_version ?? "0.8.0", experiment: protocol.experiment ?? "Installed integration with spontaneous tool choice", models: protocol.model, clients, runs: safe, limitations: protocol.caveats }, null, 2) + "\n");
  writeFileSync(join(PUBLIC, "protocol.json"), JSON.stringify({ ...Object.fromEntries(Object.entries(protocol).filter(([key]) => !["package_root", "installed_core_hashes"].includes(key))), preparation_ms: read(join(OUTPUT, "preparation.json")).preparation_ms }, null, 2) + "\n");
  console.log(JSON.stringify({ complete: runs.length === planned, runs: runs.length, clients }));
}
