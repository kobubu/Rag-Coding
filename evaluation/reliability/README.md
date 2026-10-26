# Harness reliability regression, 0.9.2

The audit reproduced three failures on baseline `e6300cd`: a missing index aborting automatic pre-step, a diagnostic write failure preventing compact tool registration, and one agent receiving a whole-file read pointer for context delivered only to another agent. The original suite passed 57 tests. The added behavioral tests failed on the old plugin and passed after the fix; the final suite passed 61 tests on Node 24.21.0 after a fresh locked install.

[Recorded checks](v0.9.2/regression.json) · [Live protocol](v0.9.2/protocol.json) · [All live results](v0.9.2/results.json) · [Runner](run.mjs)

Four paid Harness sessions compare the original and new plugin on two synthetic JavaScript changes, once per arm. All four changed the file correctly and passed independent checks including zero, negative input, and fractional values. All first model requests contained CM context. Every attempt, final source, provider usage record, retrieval event log, and process result is retained under its run name. Local checkout paths are redacted; credentials are never serialized. No attempts were excluded.

The model is GPT-6 Luna, low reasoning, with identical prompts and limits for both arms. Arm order is reversed for the second task. Six calls and 120 seconds cap each run. The automatic-context fallback, filesystem cancellation, diagnostic failures, and agent isolation are exercised by deterministic integration tests using the real Harness ToolRuntime and LocalFileSystem; the paid sessions cover the healthy edit path only.

This is a small regression check, not a performance study. One repeat, two trivial tasks, provider caching, and startup time preclude claims about speed, savings, or broad task quality. Ranking, embeddings, and source budgets did not change.

To reproduce after `npm run compile`, provide a complete frozen baseline runtime tree (including its contracts), a compatible Harness installation, and `OPENAI_API_KEY` or `CM_AB_API_KEY` in the environment:

```bash
node evaluation/reliability/run.mjs /new/output /baseline/dist/src/harness/plugin.js /harness/lib/bin.js
```

The runner refuses to reuse an output directory and retains failed runs as well as successes. It operates only on generated synthetic fixtures. The separate raw run folders include local harness configuration references; they are evidence, not reusable installed profiles.
