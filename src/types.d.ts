declare module '@modelcontextprotocol/sdk/server' {
  export class Server {
    constructor(options: any, capabilities: any);
    setRequestHandler(schema: any, handler: any): void;
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
    onerror: (error: Error) => void;
    handleJsonRpcRequest(request: any): Promise<any>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio' {
  export class StdioServerTransport {
    constructor();
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
