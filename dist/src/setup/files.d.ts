export declare function text(path: string): Promise<string | undefined>;
export declare function safeTarget(root: string, path: string): Promise<void>;
export type Edit = {
    root: string;
    path: string;
    before: string | undefined;
    after: string | undefined;
};
export declare function change(edit: Edit): Promise<void>;
export declare function transaction(edits: Edit[]): Promise<void>;
