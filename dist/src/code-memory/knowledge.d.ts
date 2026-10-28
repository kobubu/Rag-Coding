import type { CMIndex, CMUnit, CMSymbol } from "./types.js";
export type Knowledge = {
    roots: CMUnit[];
    units: Map<string, CMUnit>;
    symbols: Map<string, CMSymbol>;
    names: Map<string, CMUnit[]>;
    outgoing: Map<string, Set<string>>;
    incoming: Map<string, Set<string>>;
    vocabulary: Map<string, Set<string>>;
    frequency: Map<string, number>;
    owner: (id: string) => CMUnit | undefined;
};
export declare function knowledge(index: CMIndex): Knowledge;
