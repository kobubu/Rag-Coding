// Shared text of the UserPromptSubmit hook used by Codex and Claude Code.
export const GUIDANCE = "Code Memory (CM) context: the source below is the exact current saved content of these files, checked against their hashes. " +
  "Files marked (whole file) are complete and byte-exact: do not cat, sed or head them, and copy patch context lines straight from this text. " +
  "Listed call sites come from the compiler graph, so a call-site search is unnecessary. " +
  "When the shown code is enough for the fix, first reason through the behavior it must keep (edge cases, ordering, ties, return shape), " +
  "then make the edit in your first tool call and run any check after it in that same call; a baseline run before editing is unnecessary. " +
  "Read or search only for code that is not shown.";
// Claude Code edits with its Edit tool; the Codex wording made it script the edit through Bash, an extra permission and turn.
export const CLAUDE_GUIDANCE = GUIDANCE.replace("then make the edit in your first tool call and run any check after it in that same call",
  "then make every edit with the Edit tool as your first step (several Edit calls may share one message) and run any check right after them");
export type HookClient = "codex" | "claude";

export function hookOutput(context: string, client: HookClient = "codex"): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: (client === "claude" ? CLAUDE_GUIDANCE : GUIDANCE) + "\n\n" + context } });
}
