export type Delivered = {
    path: string;
    version: string;
    lines: number;
};
/** Records the whole files of a context the hook just added, keyed by absolute path. */
export declare function rememberDelivered(session: string, root: string, whole: Delivered[]): void;
/** Files read by a command made only of plain reads (joined by && or ;), or by a Read tool call; undefined for anything else. */
export declare function readTargets(tool: string, input: unknown, cwd: string): string[] | undefined;
export declare const readTarget: (tool: string, input: unknown, cwd: string) => string | undefined;
/** Returns the pointer text when this tool call only re-reads unchanged files shown whole, each for the first time; otherwise undefined. */
export declare function rereadPointer(session: string, tool: string, input: unknown, cwd: string): string | undefined;
export declare function preToolOutput(reason: string): string;
