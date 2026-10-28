// Agent hosts append process instructions ("apply only in this workspace", "finish with a summary") to the task text.
// Those sentences carry no information about where the code is, yet they dominate lexical and dense ranking.
// Absolute paths (a check script, a temp directory) are dropped too: their random run ids shuffled the dense ranking.
const GENERIC = new Set(("a an the and or of to in on at by for from with without when then than only this that these those it its your you all any same other otherwise " +
    "is are be been was were do does not no must should can may will please also each every both either via into onto per " +
    "apply applies change changes changed edit edits modify isolated workspace preserve unrelated behavior behaviour interface interfaces " +
    "use used supplied source sources sufficient inspect code project check checks smoke available variant variants separate independent " +
    "final evaluate evaluates evaluated patch patches finish brief summary summarize keep task tasks tool tools file files repository repo " +
    "commit publish deploy access work working instruction instructions test tests run runs passing make sure done result results public shell command commands").split(" "));
// An absolute path keeps only a source file name; anything else in it (home, run directory, script) is noise.
const ABSOLUTE_PATH = /(?<![\w.`])(?:~|[A-Za-z]:)?[\\/](?:[^\s`'"\\/;,]+[\\/])+[^\s`'";,]*/g;
const CODE_FILE = /[\w$-]+\.(?:[cm]?[jt]sx?)$/;
const CODE_SHAPED = /`[^`]+`|[\w$-]+\.(?:[cm]?[jt]sx?)\b|\b[a-z]+[A-Z][\w$]*/;
/** Removes sentences made only of generic agent-process wording; returns the input when nothing task-specific would remain. */
export function focusQuery(query) {
    const sentences = query.replace(ABSOLUTE_PATH, path => path.match(CODE_FILE)?.[0] ?? "").split(/(?<=[.!?;])\s+|\n+/).map(sentence => sentence.trim()).filter(Boolean);
    const kept = sentences.filter(sentence => {
        if (CODE_SHAPED.test(sentence))
            return true;
        const content = (sentence.toLowerCase().match(/[\p{L}][\p{L}\p{N}'_-]*/gu) ?? []).flatMap(word => word.split(/_/)).filter(word => word.length > 2);
        return content.length > 0 && content.filter(word => GENERIC.has(word)).length / content.length < 0.8;
    });
    return kept.length ? kept.join(" ") : query;
}
