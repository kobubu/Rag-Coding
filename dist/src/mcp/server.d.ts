import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LocalCM } from "../local-agent/service.js";
import type { RetrievedContext } from "../code-memory/retrieve.js";
export declare function contextReply(context: RetrievedContext): {
    content: {
        type: "text";
        text: string;
    }[];
    structuredContent: {
        snapshot_id: string;
        channels: string[];
        bytes_used: number;
        omissions: number;
        complete: boolean;
        source_context: string;
        sources: {
            path: string;
            span: import("../code-memory/types.js").SourceSpan;
            reason: "match" | "dependency" | "signature";
        }[];
        references_truncated: boolean;
    };
};
export declare function createMcpServer(service: LocalCM): McpServer;
