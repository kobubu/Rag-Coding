import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { hookDirectory } from "./client.js";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const statePath = (session) => join(hookDirectory(), "session-" + sha(session).slice(0, 24) + ".json");
function load(session) {
    try {
        const state = JSON.parse(readFileSync(statePath(session), "utf8"));
        return { delivered: state.delivered ?? {}, pointed: state.pointed ?? [] };
    }
    catch {
        return { delivered: {}, pointed: [] };
    }
}
function save(session, state) {
    const path = statePath(session), temp = path + "." + process.pid + ".tmp";
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, path);
}
/** Records the whole files of a context the hook just added, keyed by absolute path. */
export function rememberDelivered(session, root, whole) {
    if (!session || !whole.length)
        return;
    const state = load(session);
    for (const file of whole)
        state.delivered[resolve(root, file.path)] = file;
    save(session, state);
}
// A read of exactly one file: cat, sed -n 'a,bp', head/tail with a count, nl -ba, optionally piped into sed/head/tail filters.
const READ = /^(?:cat|nl\s+-ba|sed\s+-n\s+'?\d+(?:,\d+)?p'?|head(?:\s+-n\s*\d+|\s+-\d+)?|tail(?:\s+-n\s*\+?\d+|\s+-\d+)?)\s+(['"]?)([^\s'"|;&<>`$]+)\1$/;
const FILTER = /^(?:sed\s+-n\s+'?\d+(?:,\d+)?p'?|head(?:\s+-n\s*\d+|\s+-\d+)?|tail(?:\s+-n\s*\+?\d+|\s+-\d+)?)$/;
/** Files read by a command made only of plain reads (joined by && or ;), or by a Read tool call; undefined for anything else. */
export function readTargets(tool, input, cwd) {
    const args = (input ?? {});
    if (tool === "Read" && typeof args.file_path === "string")
        return [isAbsolute(args.file_path) ? args.file_path : resolve(cwd, args.file_path)];
    if (tool !== "Bash" || typeof args.command !== "string" || /[<>`$\n]|\|\||(?<!&)&(?!&)/.test(args.command))
        return;
    const targets = [];
    for (const step of args.command.split(/&&|;/).map(part => part.trim())) {
        const [first, ...filters] = step.split("|").map(part => part.trim());
        const match = first?.match(READ);
        if (!match || filters.some(filter => !FILTER.test(filter)))
            return;
        targets.push(resolve(cwd, match[2]));
    }
    return targets.length ? targets : undefined;
}
export const readTarget = (tool, input, cwd) => { const targets = readTargets(tool, input, cwd); return targets?.length === 1 ? targets[0] : undefined; };
/** Returns the pointer text when this tool call only re-reads unchanged files shown whole, each for the first time; otherwise undefined. */
export function rereadPointer(session, tool, input, cwd) {
    const targets = session ? readTargets(tool, input, cwd) : undefined;
    if (!targets)
        return;
    const state = load(session), shown = [];
    for (const target of new Set(targets)) {
        const file = state.delivered[target];
        if (!file || state.pointed.includes(target))
            return;
        let current;
        try {
            current = readFileSync(target);
        }
        catch {
            return;
        }
        if ("blob:" + sha(current) !== file.version)
            return;
        shown.push(file);
    }
    state.pointed.push(...new Set(targets));
    save(session, state);
    const list = shown.map(file => `${file.path} (lines 1-${file.lines})`).join(", ");
    return `Unchanged since the Code Memory context above, which shows ${shown.length > 1 ? "these files" : "this file"} whole: ${list}. Use that text; edit directly. Read again only if you need it repeated.`;
}
export function preToolOutput(reason) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
}
