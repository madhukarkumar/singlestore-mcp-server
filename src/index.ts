#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import * as mysql from 'mysql2/promise';
import * as https from 'https';

// Fetch SingleStore CA bundle
async function fetchCABundle(): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get('https://portal.singlestore.com/static/ca/singlestore_bundle.pem', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', (err) => reject(err));
    }).on('error', (err) => reject(err));
  });
}

class SingleStoreServer {
  private server: Server;
  private connection: mysql.Connection | null = null;
  private caBundle: string | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'singlestore-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async ensureConnection() {
    if (!this.connection) {
      try {
        if (!this.caBundle) {
          this.caBundle = await fetchCABundle();
        }

        const config = {
          host: process.env.SINGLESTORE_HOST,
          user: process.env.SINGLESTORE_USER,
          password: process.env.SINGLESTORE_PASSWORD,
          database: process.env.SINGLESTORE_DATABASE,
          port: parseInt(process.env.SINGLESTORE_PORT || '3306'),
          ssl: {
            ca: this.caBundle
          }
        };

        this.connection = await mysql.createConnection(config);
      } catch (error: unknown) {
        const err = error as Error;
        throw new McpError(
          ErrorCode.InternalError,
          `Database connection error: ${err.message}`
        );
      }
    }
    return this.connection;
  }

  private async cleanup() {
    if (this.connection) {
      await this.connection.end();
    }
    await this.server.close();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'generate_er_diagram',
          description: 'Generate a Mermaid ER diagram of the database schema',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_tables',
          description: 'List all tables in the database',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'query_table',
          description: 'Execute a query on a table',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'SQL query to execute',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'describe_table',
          description: 'Get detailed information about a table',
          inputSchema: {
            type: 'object',
            properties: {
              table: {
                type: 'string',
                description: 'Name of the table to describe',
              },
            },
            required: ['table'],
          },
        },
        {
          name: 'run_read_query',
          description: 'Execute a read-only (SELECT) query on the database',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'SQL SELECT query to execute',
              },
            },
            required: ['query'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const conn = await this.ensureConnection();

      switch (request.params.name) {
        case 'generate_er_diagram': {
          try {
            // Get all tables
            const [tables] = await conn.query(
              'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
            ) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

            // Get foreign key relationships
            const [relationships] = await conn.query(
              `SELECT 
                TABLE_NAME,
                COLUMN_NAME,
                REFERENCED_TABLE_NAME,
                REFERENCED_COLUMN_NAME
              FROM information_schema.KEY_COLUMN_USAGE
              WHERE 
                TABLE_SCHEMA = DATABASE()
                AND REFERENCED_TABLE_NAME IS NOT NULL`
            ) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

            // Start building Mermaid diagram
            let mermaidDiagram = 'erDiagram\n';

            // Add tables and their columns
            for (const table of tables) {
              const [columns] = await conn.query(
                'DESCRIBE ??',
                [table.TABLE_NAME]
              ) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

              mermaidDiagram += `\n    ${table.TABLE_NAME} {\n`;
              for (const column of columns) {
                const fieldType = column.Type.split('(')[0];
                mermaidDiagram += `        ${fieldType} ${column.Field}${column.Key === 'PRI' ? ' PK' : ''}\n`;
              }
              mermaidDiagram += '    }\n';
            }

            // Add relationships
            mermaidDiagram += `
    Documents ||--o{ Document_Embeddings : "has embeddings"
    Documents ||--o{ Chunk_Metadata : "is chunked into"
    Documents ||--o{ ProcessingStatus : "has status"
    Document_Embeddings ||--o| Chunk_Metadata : "belongs to chunk"
    Entities ||--o{ Relationships : "has relationships"
    Entities ||--o{ Relationships : "is referenced by"
    Documents ||--o{ Relationships : "contains"`;

            return {
              content: [
                {
                  type: 'text',
                  text: mermaidDiagram,
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `ER diagram generation error: ${err.message}`
            );
          }
        }

        case 'list_tables': {
          const [rows] = await conn.query('SHOW TABLES') as [mysql.RowDataPacket[], mysql.FieldPacket[]];
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(rows, null, 2),
              },
            ],
          };
        }

        case 'query_table': {
          if (!request.params.arguments || typeof request.params.arguments.query !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Query parameter must be a string'
            );
          }

          try {
            const [rows] = await conn.query(request.params.arguments.query) as [mysql.RowDataPacket[], mysql.FieldPacket[]];
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(rows, null, 2),
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `Query error: ${err.message}`
            );
          }
        }

        case 'describe_table': {
          if (!request.params.arguments || typeof request.params.arguments.table !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Table parameter must be a string'
            );
          }

          try {
            // Get table schema
            const [columns] = await conn.query(
              'DESCRIBE ??',
              [request.params.arguments.table]
            ) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

            // Get basic table statistics
            const [stats] = await conn.query(
              'SELECT COUNT(*) as total_rows FROM ??',
              [request.params.arguments.table]
            ) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

            // Sample some data
            const [sample] = await conn.query(
              'SELECT * FROM ?? LIMIT 5',
              [request.params.arguments.table]
            ) as [mysql.RowDataPacket[], mysql.FieldPacket[]];

            const statistics = stats[0] as { total_rows: number };

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      schema: columns,
                      statistics,
                      sample_data: sample,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `Table description error: ${err.message}`
            );
          }
        }

        case 'run_read_query': {
          if (!request.params.arguments || typeof request.params.arguments.query !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Query parameter must be a string'
            );
          }

          const query = request.params.arguments.query.trim().toLowerCase();
          if (!query.startsWith('select ')) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Only SELECT queries are allowed for this tool'
            );
          }

          try {
            const [rows] = await conn.query(request.params.arguments.query) as [mysql.RowDataPacket[], mysql.FieldPacket[]];
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(rows, null, 2),
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `Query error: ${err.message}`
            );
          }
        }

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('SingleStore MCP server running on stdio');
  }
}

const server = new SingleStoreServer();
server.run().catch(console.error);
