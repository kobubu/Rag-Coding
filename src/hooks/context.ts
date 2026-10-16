// Shared text of the UserPromptSubmit hook used by Codex and Claude Code.
export const GUIDANCE = "Code Memory (CM) context: the source below is the current saved content of these files, checked against their hashes. " +
  "Files marked (whole file) are complete, so do not re-read them; listed call sites come from the compiler graph, so a call-site search is unnecessary. " +
  "When the fix touches one or two places in shown code, edit directly without a separate plan, but first reason through the behavior the shown code must keep " +
  "(edge cases, ordering, ties, return shape). Read or search only for code that is not shown.";

export function hookOutput(context: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: GUIDANCE + "\n\n" + context } });
}
