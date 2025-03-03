declare module '@modelcontextprotocol/sdk/server' {
  export class Server {
    constructor(options: any, capabilities: any);
    setRequestHandler(schema: any, handler: any): void;
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
    onerror: (error: Error) => void;
    handleMessage?(message: any): void;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio' {
  export class StdioServerTransport {
    constructor();
  }
}

declare module '@modelcontextprotocol/sdk/server/sse' {
  export interface SseClientConnection {
    id: string;
    res: any;
    send: (data: any) => void;
    close: () => void;
    onclose?: () => void;
    onerror?: (error: Error) => void;
  }

  export class SSEServerTransport {
    constructor(endpoint: string, res: any);
    clients: Map<string, SseClientConnection>;
    broadcast(data: any): void;
    close(): void;
    onmessage?: (message: any) => void;
    handlePostMessage?(req: any, res: any): void;
    send(message: any): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/types' {
  export const CallToolRequestSchema: any;
  export const ListToolsRequestSchema: any;
  export const ErrorCode: any;
  export class McpError extends Error {
    constructor(code: any, message: string);
  }
}

declare module 'mysql2/promise' {
  export interface Connection {
    query(sql: string, values?: any[]): Promise<any>;
    end(): Promise<void>;
  }
  export interface RowDataPacket {}
  export interface FieldPacket {}
  export function createConnection(config: any): Promise<Connection>;
}
