// Run after compile: node evaluation/reliability/run.mjs OUT BASE_PLUGIN HARNESS
// Credentials are inherited from OPENAI_API_KEY or CM_AB_API_KEY, never serialized.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { bootProfile } from '../../dist/scripts/harness_ab.js';

const [outputArg, baselineArg, harnessArg] = process.argv.slice(2);
assert(outputArg && baselineArg && harnessArg, 'Provide OUT BASE_PLUGIN HARNESS');
const output = resolve(outputArg), baseline = resolve(baselineArg), harness = resolve(harnessArg);
assert(!existsSync(output), 'Use a new output directory; all attempts are retained');
const apiKey = process.env.CM_AB_API_KEY ?? process.env.OPENAI_API_KEY;
assert(apiKey, 'Missing model credential');
mkdirSync(output, { recursive: true });
const tasks = [
  { id: 'clamp', source: 'export function remaining(limit, used) { return limit - used; }\n',
    prompt: 'In rules.js, change remaining(limit, used) so that it never returns a negative number. Preserve subtraction for positive remaining values. Edit the file and summarize.',
    checks: [[3, 1, 2], [3, 5, 0], [0, 0, 0], [2.5, 1, 1.5]] },
  { id: 'cap', source: 'export function remaining(limit, used) { return Math.max(0, limit - used); }\n',
    prompt: 'In rules.js, change remaining(limit, used) so that negative used is treated as zero. Preserve the zero floor and fractional arithmetic. Edit the file and summarize.',
    checks: [[3, -2, 3], [3, 5, 0], [0, 0, 0], [2.5, 1, 1.5]] },
];
const candidate = resolve('dist/src/harness/plugin.js');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const protocol = { format: 'cm-reliability-1', model: 'gpt-6-luna', reasoning: 'low', runtime: process.version,
  baseline_sha256: digest(baseline), candidate_sha256: digest(candidate), harness_sha256: digest(harness),
  tasks, arms: ['baseline', 'candidate'], repetitions: 1, max_calls: 6, max_seconds: 120,
  limits: 'Synthetic healthy-path regression only; no general efficiency or recovery-rate claim.' };
writeFileSync(join(output, 'protocol.json'), JSON.stringify(protocol, null, 2));
const results = [];
for (const [i, task] of tasks.entries()) for (const arm of i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
  const runId = `${task.id}-${arm}`, workspace = join(output, 'workspaces', runId);
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'rules.js'), task.source);
  writeFileSync(join(workspace, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(workspace, 'AGENTS.md'), 'Work only in this synthetic fixture. Do not commit, deploy, access the network, or change files other than rules.js.\n');
  const run = await bootProfile({ project: workspace, output, node: process.execPath, harness, apiKey, model: protocol.model,
    cmMode: 'compact', cmPluginPath: arm === 'baseline' ? baseline : candidate, maxCalls: 6, maxSeconds: 120 }, workspace, runId, task.prompt, true);
  let quality = false;
  try {
    const values = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      'import {remaining} from "./rules.js"; console.log(JSON.stringify(' + JSON.stringify(task.checks) + '.map(([a,b])=>remaining(a,b))));'],
      { cwd: workspace, encoding: 'utf8', timeout: 10000, windowsHide: true }));
    quality = JSON.stringify(values) === JSON.stringify(task.checks.map(check => check[2]));
  } catch { /* A broken patch is a retained failed attempt. */ }
  const meterPath = join(run.directory, 'meter.json');
  const meter = existsSync(meterPath) ? JSON.parse(readFileSync(meterPath, 'utf8')) : { calls: [] };
  const retrievalPath = join(run.directory, 'retrieval.json');
  const retrieval = existsSync(retrievalPath) ? JSON.parse(readFileSync(retrievalPath, 'utf8')) : [];
  const result = { run: runId, arm, task: task.id, exit_code: run.exit_code, duration_ms: run.duration_ms, quality,
    changed: readFileSync(join(workspace, 'rules.js'), 'utf8') !== task.source,
    calls: meter.calls.length, context_in_first_request: meter.calls[0]?.cm_context_present ?? false,
    retrieval_events: retrieval.filter(event => event.event === 'retrieved').length,
    usage: meter.calls.map(call => call.usage) };
  results.push(result);
  writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
}
if (results.some(result => !result.quality || !result.changed || result.exit_code !== 0 || !result.context_in_first_request)) process.exitCode = 1;
