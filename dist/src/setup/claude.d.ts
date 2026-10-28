import type { StdioConfig } from "./config.js";
import type { Edit } from "./files.js";
export declare function checkClaudeRoot(project: string): Promise<void>;
export declare function withClaude(edits: Edit[], project: string, name: string, desired: StdioConfig | undefined, previous: StdioConfig | undefined): Promise<void>;
