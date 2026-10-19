import http from "node:http";
import { LocalCM } from "./service.js";
export declare function startViewer(service: LocalCM, port?: number, directory?: string): Promise<{
    url: string;
    server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;
    close: () => Promise<void>;
}>;
