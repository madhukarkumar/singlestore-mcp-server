#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import * as mysql from 'mysql2/promise';
import * as https from 'https';
import { IncomingMessage } from 'http';

// Fetch SingleStore CA bundle
async function fetchCABundle(): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get('https://portal.singlestore.com/static/ca/singlestore_bundle.pem', (res: IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', (err: Error) => reject(err));
    }).on('error', (err: Error) => reject(err));
  });
}

// Validate required environment variables
function validateEnvVars(): void {
  const required = [
    'SINGLESTORE_HOST',
    'SINGLESTORE_USER',
    'SINGLESTORE_PASSWORD',
    'SINGLESTORE_DATABASE'
  ];
  
  const missing = required.filter(var_name => !process.env[var_name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

interface TableRow extends mysql.RowDataPacket {
  TABLE_NAME: string;
}

interface ColumnInfo extends mysql.RowDataPacket {
  Field: string;
  Type: string;
  Key: string;
}

interface RelationshipInfo extends mysql.RowDataPacket {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
}

class SingleStoreServer {
  private server: Server;
  private connection: mysql.Connection | null = null;
  private caBundle: string | null = null;

  constructor() {
    validateEnvVars();

    this.server = new Server(
      {
        name: 'mcp-server-singlestore',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async ensureConnection(): Promise<mysql.Connection> {
    if (!this.connection) {
      try {
        if (!this.caBundle) {
          this.caBundle = await fetchCABundle();
        }

        const config: mysql.ConnectionOptions = {
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

  private async cleanup(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
    }
    await this.server.close();
  }

  private setupToolHandlers(): void {
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
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const conn = await this.ensureConnection();

      switch (request.params.name) {
        case 'generate_er_diagram': {
          try {
            // Get all tables
            const [tables] = await conn.query<TableRow[]>(
              'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
            );

            // Get foreign key relationships
            const [relationships] = await conn.query<RelationshipInfo[]>(
              `SELECT 
                TABLE_NAME,
                COLUMN_NAME,
                REFERENCED_TABLE_NAME,
                REFERENCED_COLUMN_NAME
              FROM information_schema.KEY_COLUMN_USAGE
              WHERE 
                TABLE_SCHEMA = DATABASE()
                AND REFERENCED_TABLE_NAME IS NOT NULL`
            );

            // Start building Mermaid diagram
            let mermaidDiagram = 'erDiagram\n';

            // Add tables and their columns
            for (const table of tables) {
              const [columns] = await conn.query<ColumnInfo[]>(
                'DESCRIBE ??',
                [table.TABLE_NAME]
              );

              mermaidDiagram += `\n    ${table.TABLE_NAME} {\n`;
              for (const column of columns) {
                const fieldType = column.Type.split('(')[0];
                mermaidDiagram += `        ${fieldType} ${column.Field}${column.Key === 'PRI' ? ' PK' : ''}\n`;
              }
              mermaidDiagram += '    }\n';
            }

            // Add relationships based on foreign keys
            for (const rel of relationships) {
              mermaidDiagram += `\n    ${rel.TABLE_NAME} }|--|| ${rel.REFERENCED_TABLE_NAME} : references`;
            }

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
          const [rows] = await conn.query<TableRow[]>('SHOW TABLES');
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
            const [rows] = await conn.query<mysql.RowDataPacket[]>(request.params.arguments.query);
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
            const [columns] = await conn.query<ColumnInfo[]>(
              'DESCRIBE ??',
              [request.params.arguments.table]
            );

            // Get basic table statistics
            const [stats] = await conn.query<mysql.RowDataPacket[]>(
              'SELECT COUNT(*) as total_rows FROM ??',
              [request.params.arguments.table]
            );

            // Sample some data
            const [sample] = await conn.query<mysql.RowDataPacket[]>(
              'SELECT * FROM ?? LIMIT 5',
              [request.params.arguments.table]
            );

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

        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('SingleStore MCP server running on stdio');
  }
}

const server = new SingleStoreServer();
server.run().catch(console.error);
