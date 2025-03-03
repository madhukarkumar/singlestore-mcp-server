#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { CustomSseTransport } from './custom-sse.js';
import { DirectSseTransport } from './direct-sse.js';
import * as mysql from 'mysql2/promise';
import { randomBytes } from 'crypto';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http';
import * as https from 'https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as net from 'net';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(dirname(__dirname), '.env');
const log = (message: string, ...args: any[]) => {
  // Only log to stderr to avoid interfering with STDIO transport
  if (args.length === 0) {
    process.stderr.write(`${message}\n`);
  } else {
    let formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    process.stderr.write(`${message} ${formattedArgs}\n`);
  }
};
log(`Loading environment variables from: ${envPath}`);
dotenv.config({ path: envPath });

// Log all environment variables for debugging (excluding sensitive ones)
log('Environment variables loaded:');
log('All environment variable keys:', Object.keys(process.env).filter(key => 
  key.includes('SINGLE') || key.includes('DB_') || key.includes('MCP')
).join(', '));
log(`SINGLESTORE_HOST: ${process.env.SINGLESTORE_HOST || 'not set'}`);
log(`SINGLESTORE_USER: ${process.env.SINGLESTORE_USER || 'not set'}`);
log(`SINGLESTORE_DATABASE: ${process.env.SINGLESTORE_DATABASE || 'not set'}`);
log(`SINGLESTORE_PORT: ${process.env.SINGLESTORE_PORT || 'not set'}`);
log(`DB_HOST: ${process.env.DB_HOST || 'not set'}`);
log(`DB_USER: ${process.env.DB_USER || 'not set'}`);
log(`DB_NAME: ${process.env.DB_NAME || 'not set'}`);
log(`DB_PORT: ${process.env.DB_PORT || 'not set'}`);
log(`MCP_SSE_PORT: ${process.env.MCP_SSE_PORT || 'not set'}`);
log(`SSE_KEEPALIVE_INTERVAL_MS: ${process.env.SSE_KEEPALIVE_INTERVAL_MS || 'not set'}`);

// Define extended RowDataPacket interfaces for better type safety
interface TableRowDataPacket extends mysql.RowDataPacket {
  TABLE_NAME: string;
}

interface ColumnRowDataPacket extends mysql.RowDataPacket {
  Field: string;
  Type: string;
  Null: string;
  Key: string;
  Default?: string;
  Extra?: string;
}

// Define ResultSetHeader interface - mysql2 doesn't export ResultSetHeader directly
interface ResultSetHeader {
  affectedRows: number;
  insertId: number;
  warningStatus: number;
}

// Define TableOptions interface for better type safety
interface TableOptions {
  is_reference?: boolean;
  shard_key?: string[];
  sort_key?: string[];
  compression?: string;
  auto_increment_start?: number;
}

interface ColumnGenerator {
  type: 'sequence' | 'random' | 'values' | 'formula';
  start?: number;
  increment?: number;
  end?: number;
  values?: any[];
  formula?: string;
}

interface Column {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string | number | boolean;
  auto_increment?: boolean;
}

interface CreateTableArguments {
  table_name: string;
  columns: Column[];
  table_options?: TableOptions;
}

interface GenerateSyntheticDataArguments {
  table: string;
  count?: number;
  batch_size?: number;
  column_generators?: Record<string, ColumnGenerator>;
}

// Interface for SQL optimization recommendations
interface OptimizationRecommendation {
  summary: {
    total_runtime_ms: string;
    compile_time_ms: string;
    execution_time_ms: string;
    bottlenecks: string[];
  };
  suggestions: Array<{
    issue: string;
    recommendation: string;
    impact: 'high' | 'medium' | 'low';
  }>;
  optimizedQuery?: string;
}

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

class SingleStoreMcpServer {
  private server: Server;
  private connection: mysql.Connection | null = null;
  private app: express.Application;
  private sseTransport: DirectSseTransport | null = null;
  private httpServer: http.Server;

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

    this.app = express();
    this.httpServer = http.createServer(this.app);
    
    // Configure CORS for SSE endpoint
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
      credentials: true
    }));
  }

  private async ensureConnection() {
    if (!this.connection) {
      try {
        log('Attempting to connect to database with the following parameters:');
        
        // Log raw environment variables for debugging
        log('Raw environment variables for connection:');
        log(`SINGLESTORE_HOST: ${process.env.SINGLESTORE_HOST || 'not set'}`);
        log(`SINGLESTORE_USER: ${process.env.SINGLESTORE_USER || 'not set'}`);
        log(`SINGLESTORE_DATABASE: ${process.env.SINGLESTORE_DATABASE || 'not set'}`);
        log(`SINGLESTORE_PORT: ${process.env.SINGLESTORE_PORT || 'not set'}`);
        
        // Check if we're connecting to a SingleStore cloud instance
        const isSingleStoreCloud = process.env.SINGLESTORE_HOST && 
          (process.env.SINGLESTORE_HOST.includes('singlestore.com') || 
           process.env.SINGLESTORE_HOST.includes('memsql.com'));
        
        log(`Detected SingleStore Cloud: ${isSingleStoreCloud}`);
        
        // For logging only (hide password)
        const connectionConfig = {
          host: process.env.SINGLESTORE_HOST || process.env.DB_HOST || 'localhost',
          user: process.env.SINGLESTORE_USER || process.env.DB_USER || 'root',
          password: process.env.SINGLESTORE_PASSWORD ? '****' : (process.env.DB_PASSWORD ? '****' : ''), // Hide actual password in logs
          database: process.env.SINGLESTORE_DATABASE || process.env.DB_NAME,
          port: parseInt(process.env.SINGLESTORE_PORT || process.env.DB_PORT || '3306', 10),
          ssl: isSingleStoreCloud ? { rejectUnauthorized: true } : undefined,
          multipleStatements: true
        };
        
        log('Final connection configuration (with fallbacks applied):');
        log(`Host: ${connectionConfig.host}`);
        log(`User: ${connectionConfig.user}`);
        log(`Database: ${connectionConfig.database || 'undefined'}`);
        log(`Port: ${connectionConfig.port}`);
        log(`SSL: ${connectionConfig.ssl ? 'Enabled' : 'Disabled'}`);
        
        // Create actual connection with real password
        const config = {
          host: process.env.SINGLESTORE_HOST || process.env.DB_HOST || 'localhost',
          user: process.env.SINGLESTORE_USER || process.env.DB_USER || 'root',
          password: process.env.SINGLESTORE_PASSWORD || process.env.DB_PASSWORD || '',
          database: process.env.SINGLESTORE_DATABASE || process.env.DB_NAME,
          port: parseInt(process.env.SINGLESTORE_PORT || process.env.DB_PORT || '3306', 10),
          ssl: isSingleStoreCloud ? { rejectUnauthorized: true } : undefined,
          multipleStatements: true,
          // Add connection timeout and retry options
          connectTimeout: 20000 // 20 seconds
        };
        
        log('Attempting to create connection...');
        this.connection = await mysql.createConnection(config);
        
        // Test the connection with a simple query
        log('Testing connection with a simple query...');
        const [result] = await this.connection.query('SELECT 1 as test');
        log('Connection test result:', result);
        
        log('Database connection established successfully');
      } catch (error: unknown) {
        const err = error as Error;
        
        log('Database connection error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
          // Add any other properties that might be helpful
          code: (error as any).code,
          errno: (error as any).errno,
          sqlState: (error as any).sqlState,
          sqlMessage: (error as any).sqlMessage
        });
        
        throw new McpError(
          ErrorCode.InternalError,
          `Database connection error: ${err.message}`
        );
      }
    }
    return this.connection;
  }

  async cleanup() {
    log('Cleaning up resources...');
    
    // Close SSE transport if available
    if (this.sseTransport) {
      try {
        this.sseTransport.close();
        this.sseTransport = null;
      } catch (error) {
        log('Error closing SSE transport:', error);
      }
    }
    
    // Close database connection
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
      log('Database connection closed');
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
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
          {
            name: 'create_table',
            description: 'Create a new table in the database with specified columns and constraints',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: {
                  type: 'string',
                  description: 'Name of the table to create',
                },
                columns: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: {
                        type: 'string',
                        description: 'Column name',
                      },
                      type: {
                        type: 'string',
                        description: 'Data type (e.g., INT, VARCHAR(255), etc.)',
                      },
                      nullable: {
                        type: 'boolean',
                        description: 'Whether the column can be NULL',
                      },
                      default: {
                        type: 'string',
                        description: 'Default value for the column',
                      },
                      auto_increment: {
                        type: 'boolean',
                        description: 'Whether the column should auto increment',
                      },
                    },
                    required: ['name', 'type'],
                  },
                  description: 'List of columns to create',
                },
                table_options: {
                  type: 'object',
                  properties: {
                    shard_key: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Columns to use as shard key',
                    },
                    sort_key: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Columns to use as sort key',
                    },
                    is_reference: {
                      type: 'boolean',
                      description: 'Whether this is a reference table',
                    },
                    compression: {
                      type: 'string',
                      enum: ['SPARSE'],
                      description: 'Table compression type',
                    },
                    auto_increment_start: {
                      type: 'number',
                      description: 'Starting value for auto increment columns',
                    },
                  },
                },
              },
              required: ['table_name', 'columns'],
            },
          },
          {
            name: 'generate_synthetic_data',
            description: 'Generate and insert synthetic data into an existing table',
            inputSchema: {
              type: 'object',
              properties: {
                table: {
                  type: 'string',
                  description: 'Name of the table to insert data into',
                },
                count: {
                  type: 'number',
                  description: 'Number of rows to generate and insert',
                  default: 100,
                },
                batch_size: {
                  type: 'number',
                  description: 'Number of rows to insert in each batch',
                  default: 1000,
                },
                column_generators: {
                  type: 'object',
                  description: 'Custom generators for specific columns (optional)',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['sequence', 'random', 'values', 'formula'],
                        description: 'Type of generator to use',
                      },
                      start: {
                        type: 'number',
                        description: 'Starting value for sequence generator',
                      },
                      end: {
                        type: 'number',
                        description: 'Ending value for random number generator',
                      },
                      values: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of values to choose from for values generator',
                      },
                      formula: {
                        type: 'string',
                        description: 'SQL expression for formula generator',
                      },
                    },
                  },
                },
              },
              required: ['table'],
            },
          },
          {
            name: 'optimize_sql',
            description: 'Analyze a SQL query using PROFILE and provide optimization recommendations',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'SQL query to analyze and optimize',
                },
              },
              required: ['query'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const conn = await this.ensureConnection();
      
      // Find the client ID if the request has SSE metadata
      const clientId = request.params._meta?.progressToken as string;
      const useSSE = !!clientId;
      
      // Function to send progress updates via SSE if available
      const sendProgress = (message: string, progress: number) => {
        if (useSSE && this.sseTransport) {
          try {
            // Create a proper JSON-RPC notification
            this.sseTransport.send({
              jsonrpc: "2.0",
              method: "progress",
              params: {
                tool: request.params.name,
                message,
                progress
              }
            });
          } catch (error) {
            log('Error sending progress update:', error);
          }
        }
      };

      switch (request.params.name) {
        case 'generate_er_diagram': {
          try {
            // Send initial progress update
            sendProgress('Starting to generate ER diagram...', 0);
            
            // Get all tables
            const [tables] = await conn.query(
              'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
            ) as [TableRowDataPacket[], mysql.FieldPacket[]];

            sendProgress('Retrieved tables, fetching relationships...', 20);
            
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
              ) as [ColumnRowDataPacket[], mysql.FieldPacket[]];

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

            // Send progress update
            sendProgress('ER diagram generation complete', 100);
            
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
            
            // Send error via SSE if available
            if (useSSE && this.sseTransport) {
              try {
                // Create a proper JSON-RPC error response
                this.sseTransport.send({
                  jsonrpc: "2.0",
                  method: "error",
                  params: {
                    tool: request.params.name,
                    error: {
                      code: -32000,
                      message: err.message
                    }
                  }
                });
              } catch (error) {
                log('Error sending error via SSE:', error);
              }
            }
            
            return {
              error: err.message
            };
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
            return {
              error: 'Query parameter must be a string'
            };
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
            return {
              error: `Query error: ${err.message}`
            };
          }
        }

        case 'describe_table': {
          if (!request.params.arguments || typeof request.params.arguments.table !== 'string') {
            return {
              error: 'Table parameter must be a string'
            };
          }

          try {
            // Get table schema
            const [columns] = await conn.query(
              'DESCRIBE ??',
              [request.params.arguments.table]
            ) as [ColumnRowDataPacket[], mysql.FieldPacket[]];

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
            return {
              error: `Table description error: ${err.message}`
            };
          }
        }

        case 'run_read_query': {
          if (!request.params.arguments || typeof request.params.arguments.query !== 'string') {
            return {
              error: 'Query parameter must be a string'
            };
          }

          const query = request.params.arguments.query.trim();
          
          // Check if it's a SELECT statement (read-only)
          if (!query.toLowerCase().startsWith('select')) {
            return {
              error: 'Only SELECT queries are allowed with run_read_query'
            };
          }

          try {
            // Send initial progress update
            sendProgress('Executing query...', 0);
            
            const [rows] = await conn.query(query);
            
            // Send progress update
            sendProgress('Query execution complete', 100);
            
            // Send results via SSE if available
            if (useSSE && this.sseTransport) {
              try {
                // Create a proper JSON-RPC notification
                this.sseTransport.send({
                  jsonrpc: "2.0",
                  method: "result",
                  params: {
                    tool: request.params.name,
                    data: rows
                  }
                });
              } catch (error) {
                log('Error sending results via SSE:', error);
              }
            }
            
            return {
              result: rows,
            };
          } catch (error: unknown) {
            const err = error as Error;
            
            // Send error via SSE if available
            if (useSSE && this.sseTransport) {
              try {
                // Create a proper JSON-RPC error response
                this.sseTransport.send({
                  jsonrpc: "2.0",
                  method: "error",
                  params: {
                    tool: request.params.name,
                    error: {
                      code: -32000,
                      message: err.message
                    }
                  }
                });
              } catch (error) {
                log('Error sending error via SSE:', error);
              }
            }
            
            return {
              error: `Failed to execute query: ${err.message}`
            };
          }
        }

        case 'create_table': {
          if (!request.params.arguments || !request.params.arguments.table_name || !Array.isArray(request.params.arguments.columns)) {
            return {
              error: 'Invalid parameters for create_table'
            };
          }

          try {
            // First convert to unknown, then to our expected type
            const args = request.params.arguments as unknown as CreateTableArguments;
            const { table_name, columns, table_options = {} as TableOptions } = args;
            
            // Start building the CREATE TABLE statement
            let sql = `CREATE ${(table_options as TableOptions).is_reference ? 'REFERENCE ' : ''}TABLE ${table_name} (\n`;
            
            // Add columns
            const columnDefs = columns.map(col => {
              let def = `  ${col.name} ${col.type}`;
              if (col.nullable === false) def += ' NOT NULL';
              if (col.default !== undefined) def += ` DEFAULT ${col.default}`;
              if (col.auto_increment) def += ' AUTO_INCREMENT';
              return def;
            });

            // Add primary key if auto_increment is used
            const autoIncrementCol = columns.find(col => col.auto_increment);
            if (autoIncrementCol) {
              columnDefs.push(`  PRIMARY KEY (${autoIncrementCol.name})`);
            }

            // Add shard key if specified
            if ((table_options as TableOptions).shard_key?.length) {
              columnDefs.push(`  SHARD KEY (${(table_options as TableOptions).shard_key.join(', ')})`);
            }

            // Add sort key if specified
            if ((table_options as TableOptions).sort_key?.length) {
              columnDefs.push(`  SORT KEY (${(table_options as TableOptions).sort_key.join(', ')})`);
            }

            sql += columnDefs.join(',\n');
            sql += '\n)';

            // Add table options
            const tableOptions = [];
            if ((table_options as TableOptions).compression === 'SPARSE') {
              tableOptions.push('COMPRESSION = SPARSE');
            }
            if ((table_options as TableOptions).auto_increment_start) {
              tableOptions.push(`AUTO_INCREMENT = ${(table_options as TableOptions).auto_increment_start}`);
            }
            if (tableOptions.length) {
              sql += ' ' + tableOptions.join(' ');
            }

            // Execute the CREATE TABLE statement
            await conn.query(sql);

            return {
              content: [
                {
                  type: 'text',
                  text: `Table ${table_name} created successfully`,
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            return {
              error: `Failed to create table: ${err.message}`
            };
          }
        }

        case 'generate_synthetic_data': {
          if (!request.params.arguments || typeof request.params.arguments.table !== 'string') {
            return {
              error: 'Table parameter must be a string'
            };
          }

          // First convert to unknown, then to our expected type
          const args = request.params.arguments as unknown as GenerateSyntheticDataArguments;
          const table = args.table;
          const count = Number(args.count || 100);
          const batchSize = Math.min(Number(args.batch_size || 1000), 5000);
          const columnGenerators = args.column_generators || {};

          try {
            // Get table schema to understand column types
            const [columns] = await conn.query(
              'DESCRIBE ??',
              [table]
            ) as [ColumnRowDataPacket[], mysql.FieldPacket[]];

            if (columns.length === 0) {
              return {
                error: `Table ${table} does not exist or has no columns`
              };
            }

            // Identify auto-increment columns to exclude from insert
            const autoIncrementColumns = new Set(
              columns
                .filter(col => col.Extra?.includes('auto_increment'))
                .map(col => col.Field)
            );

            // Filter out auto-increment columns
            const insertableColumns = columns.filter(col => !autoIncrementColumns.has(col.Field));
            
            if (insertableColumns.length === 0) {
              return {
                error: `Table ${table} has only auto-increment columns, cannot insert data`
              };
            }

            // Generate data in batches
            let totalInserted = 0;
            const startTime = Date.now();
            
            for (let batchStart = 0; batchStart < count; batchStart += batchSize) {
              const batchCount = Math.min(batchSize, count - batchStart);
              const rows = [];
              
              // Generate rows for this batch
              for (let i = 0; i < batchCount; i++) {
                const row: Record<string, any> = {};
                
                for (const column of insertableColumns) {
                  const columnName = column.Field;
                  const columnType = column.Type.toLowerCase();
                  const isNullable = column.Null === 'YES';
                  
                  // Check if we have a custom generator for this column
                  if (columnGenerators[columnName]) {
                    const generator = columnGenerators[columnName] as ColumnGenerator;
                    
                    switch (generator.type) {
                      case 'sequence':
                        row[columnName] = (generator.start || 0) + batchStart + i;
                        break;
                        
                      case 'random':
                        if (columnType.includes('int')) {
                          const min = generator.start || 0;
                          const max = generator.end || 1000000;
                          row[columnName] = Math.floor(Math.random() * (max - min + 1)) + min;
                        } else if (columnType.includes('float') || columnType.includes('double') || columnType.includes('decimal')) {
                          const min = generator.start || 0;
                          const max = generator.end || 1000;
                          row[columnName] = Math.random() * (max - min) + min;
                        }
                        break;
                        
                      case 'values':
                        if (Array.isArray(generator.values) && generator.values.length > 0) {
                          const index = Math.floor(Math.random() * generator.values.length);
                          row[columnName] = generator.values[index];
                        }
                        break;
                        
                      case 'formula':
                        // Formulas are applied during the INSERT statement
                        row[columnName] = null;
                        break;
                        
                      default:
                        // Fall back to default generation
                        row[columnName] = this.generateValueForColumn(columnType, isNullable);
                    }
                  } else {
                    // Use default generation based on column type
                    row[columnName] = this.generateValueForColumn(columnType, isNullable);
                  }
                }
                
                rows.push(row);
              }
              
              // Prepare column names for the INSERT statement
              const columnNames = insertableColumns.map(col => col.Field);
              
              // Prepare placeholders for the VALUES clause
              const placeholders = rows.map(() => 
                `(${columnNames.map(() => '?').join(', ')})`
              ).join(', ');
              
              // Flatten the values for the query
              const values = rows.flatMap(row => 
                columnNames.map(col => row[col])
              );
              
              // Execute the INSERT statement
              const [result] = await conn.query(
                `INSERT INTO ${table} (${columnNames.join(', ')}) VALUES ${placeholders}`,
                values
              ) as [ResultSetHeader, mysql.FieldPacket[]];
              
              totalInserted += result.affectedRows;
            }
            
            const duration = (Date.now() - startTime) / 1000;
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    table,
                    rows_inserted: totalInserted,
                    duration_seconds: duration,
                    rows_per_second: Math.round(totalInserted / duration),
                  }, null, 2),
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            return {
              error: `Failed to generate synthetic data: ${err.message}`
            };
          }
        }

        case 'optimize_sql': {
          if (!request.params.arguments || typeof request.params.arguments.query !== 'string') {
            return {
              error: 'Query parameter must be a string'
            };
          }

          const query = request.params.arguments.query.trim();
          
          try {
            // Step 1: Run PROFILE on the query
            await conn.query('SET profile_for_debug = ON');
            await conn.query(`PROFILE ${query}`);
            
            // Step 2: Get the profile data in JSON format
            const [profileResult] = await conn.query('SHOW PROFILE JSON') as [mysql.RowDataPacket[], mysql.FieldPacket[]];
            
            // Step 3: Analyze the profile data and generate recommendations
            const recommendations = this.analyzeProfileData(profileResult[0], query);
            
            // Step 4: Return the analysis and recommendations
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    original_query: query,
                    profile_summary: recommendations.summary,
                    recommendations: recommendations.suggestions,
                    optimized_query: recommendations.optimizedQuery || query,
                  }, null, 2),
                },
              ],
            };
          } catch (error: unknown) {
            const err = error as Error;
            
            return {
              error: `Query optimization error: ${err.message}`
            };
          }
        }

        default:
          return {
            error: `Unknown tool: ${request.params.name}`
          };
      }
    });
  }

  private generateValueForColumn(columnType: string, isNullable: boolean): any {
    // Handle NULL values for nullable columns (10% chance)
    if (isNullable && Math.random() < 0.1) {
      return null;
    }
    
    // Integer types
    if (columnType.includes('int')) {
      return Math.floor(Math.random() * 1000000);
    }
    
    // Decimal/numeric types
    if (columnType.includes('decimal') || columnType.includes('numeric') || 
        columnType.includes('float') || columnType.includes('double')) {
      return parseFloat((Math.random() * 1000).toFixed(2));
    }
    
    // Date and time types
    if (columnType.includes('date')) {
      const start = new Date(2020, 0, 1);
      const end = new Date();
      return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
        .toISOString().split('T')[0];
    }
    
    if (columnType.includes('time')) {
      const hours = Math.floor(Math.random() * 24);
      const minutes = Math.floor(Math.random() * 60);
      const seconds = Math.floor(Math.random() * 60);
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    if (columnType.includes('datetime') || columnType.includes('timestamp')) {
      const start = new Date(2020, 0, 1);
      const end = new Date();
      return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
        .toISOString().slice(0, 19).replace('T', ' ');
    }
    
    // Boolean/bit types
    if (columnType.includes('bool') || columnType.includes('bit(1)')) {
      return Math.random() > 0.5 ? 1 : 0;
    }
    
    // Text types
    if (columnType.includes('char') || columnType.includes('text')) {
      // Extract the length for varchar/char if specified
      let length = 10;
      const matches = columnType.match(/\((\d+)\)/);
      if (matches && matches[1]) {
        length = Math.min(parseInt(matches[1], 10), 50); // Cap at 50 to avoid huge strings
      }
      
      return randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length);
    }
    
    // JSON type
    if (columnType.includes('json')) {
      return JSON.stringify({
        id: Math.floor(Math.random() * 1000),
        name: `Item ${Math.floor(Math.random() * 100)}`,
        value: Math.random() * 100
      });
    }
    
    // Enum or set types
    if (columnType.includes('enum') || columnType.includes('set')) {
      // Extract values from enum/set definition: enum('value1','value2')
      const matches = columnType.match(/'([^']+)'/g);
      if (matches && matches.length > 0) {
        const values = matches.map(m => m.replace(/'/g, ''));
        return values[Math.floor(Math.random() * values.length)];
      }
    }
    
    // Default fallback for unknown types
    return 'unknown_type_data';
  }

  private analyzeProfileData(profileData: any, originalQuery: string): OptimizationRecommendation {
    // Parse the profile data JSON
    let profile;
    try {
      profile = typeof profileData.PROFILE === 'string' 
        ? JSON.parse(profileData.PROFILE) 
        : profileData.PROFILE;
    } catch (e) {
      return {
        summary: {
          total_runtime_ms: 'N/A',
          compile_time_ms: 'N/A',
          execution_time_ms: 'N/A',
          bottlenecks: ['Error parsing profile data']
        },
        suggestions: [{
          issue: 'Error analyzing query',
          recommendation: 'Unable to analyze query performance',
          impact: 'high'
        }],
        optimizedQuery: undefined
      };
    }

    // Extract key metrics
    const totalTime = profile.reduce((sum: number, step: any) => sum + parseFloat(step.duration), 0);
    const slowestSteps = [...profile]
      .sort((a, b) => parseFloat(b.duration) - parseFloat(a.duration))
      .slice(0, 3);
    
    // Analyze the query and profile data
    const suggestions = [];
    let optimizedQuery = originalQuery;
    
    // Check for full table scans
    const tableScans = profile.filter((step: any) => 
      step.operation.includes('TABLE SCAN') || 
      step.operation.includes('FULL SCAN')
    );
    
    if (tableScans.length > 0) {
      const tableNames = tableScans.map((step: any) => {
        const match = step.operation.match(/TABLE SCAN\s+`?(\w+)`?/i);
        return match ? match[1] : 'unknown';
      });
      
      suggestions.push(`Consider adding indexes to tables: ${tableNames.join(', ')}`);
      
      // Suggest adding WHERE clauses if missing
      if (!originalQuery.toLowerCase().includes('where')) {
        suggestions.push('Add WHERE clauses to limit the result set');
      }
    }
    
    // Check for large result sets
    const largeResults = profile.filter((step: any) => 
      step.operation.includes('SEND DATA') && 
      parseFloat(step.duration) > totalTime * 0.3
    );
    
    if (largeResults.length > 0) {
      suggestions.push('Large result set detected. Consider adding LIMIT clause or more selective WHERE conditions');
      
      // Add LIMIT if not present
      if (!originalQuery.toLowerCase().includes('limit')) {
        optimizedQuery = `${originalQuery} LIMIT 1000`;
      }
    }
    
    // Check for sorting operations
    const sortOperations = profile.filter((step: any) => 
      step.operation.includes('SORT')
    );
    
    if (sortOperations.length > 0) {
      suggestions.push('Consider adding indexes that match your ORDER BY clauses');
    }
    
    // Check for temporary tables
    const tempTables = profile.filter((step: any) => 
      step.operation.includes('TEMPORARY TABLE')
    );
    
    if (tempTables.length > 0) {
      suggestions.push('Query uses temporary tables. Consider simplifying complex joins or subqueries');
    }
    
    // Generate summary
    const summary = `Query executed in ${totalTime.toFixed(4)} seconds. ` +
      `Slowest operations: ${slowestSteps.map(s => `${s.operation} (${parseFloat(s.duration).toFixed(4)}s)`).join(', ')}`;
    
    return {
      summary: {
        total_runtime_ms: totalTime.toFixed(4),
        compile_time_ms: 'N/A',
        execution_time_ms: 'N/A',
        bottlenecks: slowestSteps.map(s => `${s.operation} (${parseFloat(s.duration).toFixed(4)}s)`)
      },
      suggestions: suggestions.length > 0 ? suggestions.map(s => ({
        issue: s,
        recommendation: s,
        impact: 'medium' as 'high' | 'medium' | 'low'
      })) : [{
        issue: 'No specific issues found',
        recommendation: 'No specific optimization suggestions',
        impact: 'low' as 'high' | 'medium' | 'low'
      }],
      optimizedQuery: optimizedQuery !== originalQuery ? optimizedQuery : undefined
    };
  }

  private analyzeExecutionPlan(profile: any, result: OptimizationRecommendation): void {
    const textProfile = profile.query_info?.text_profile || '';
    const lines = textProfile.split('\n');
    
    // Look for full table scans
    if (textProfile.includes('TableScan') && !textProfile.includes('IndexScan')) {
      result.suggestions.push({
        issue: 'Full table scan detected',
        recommendation: 'Consider adding an index to the columns used in WHERE clauses to avoid scanning the entire table.',
        impact: 'high'
      });
    }
    
    // Check for hash joins with large tables
    if (textProfile.includes('HashJoin')) {
      const rowsMatch = textProfile.match(/actual_rows: (\d+)/);
      if (rowsMatch && parseInt(rowsMatch[1], 10) > 10000) {
        result.suggestions.push({
          issue: 'Large hash join operation',
          recommendation: 'For large tables, consider using appropriate indexes on join columns or partitioning data to reduce the size of hash tables.',
          impact: 'medium'
        });
      }
    }
  }

  private analyzeMemoryAndStats(profile: any, result: OptimizationRecommendation): void {
    const textProfile = profile.query_info?.text_profile || '';
    const lines = textProfile.split('\n');
    
    // Check for high memory usage
    for (const line of lines) {
      const memoryMatch = line.match(/memory_usage: (\d+)/);
      if (memoryMatch) {
        const memoryUsage = parseInt(memoryMatch[1], 10);
        if (memoryUsage > 100000) { // More than 100MB
          result.suggestions.push({
            issue: `High memory usage (${Math.round(memoryUsage / 1024)}MB)`,
            recommendation: 'Consider adding appropriate indexes, breaking the query into smaller parts, or optimizing large in-memory operations.',
            impact: 'high'
          });
        }
      }
    }
  }

  private analyzeNetworkTraffic(profile: any, result: OptimizationRecommendation): void {
    const textProfile = profile.query_info?.text_profile || '';
    const lines = textProfile.split('\n');
    
    let totalNetworkTraffic = 0;
    
    for (const line of lines) {
      const trafficMatch = line.match(/network_traffic: (\d+(\.\d+)?)/);
      if (trafficMatch) {
        totalNetworkTraffic += parseFloat(trafficMatch[1]);
      }
    }
    
    if (totalNetworkTraffic > 100000) { // More than 100MB
      result.suggestions.push({
        issue: `High network traffic (${Math.round(totalNetworkTraffic / 1024)}MB)`,
        recommendation: 'Consider optimizing data movement between nodes by using appropriate shard keys and reducing the amount of data transferred.',
        impact: 'high'
      });
    }
  }

  private analyzeCompilationTime(profile: any, result: OptimizationRecommendation): void {
    const compileTimeStats = profile.query_info?.compile_time_stats || {};
    const totalCompileTime = parseInt(compileTimeStats.total || '0', 10);
    const totalRuntime = parseInt(profile.query_info?.total_runtime_ms || '0', 10);
    
    if (totalRuntime > 0 && totalCompileTime > 0 && (totalCompileTime / totalRuntime) > 0.2) {
      result.suggestions.push({
        issue: `High compilation time (${totalCompileTime}ms, ${Math.round((totalCompileTime / totalRuntime) * 100)}% of total runtime)`,
        recommendation: 'Consider parameterizing your queries for plan reuse or adjusting compilation-related variables.',
        impact: 'medium'
      });
    }
  }

  private analyzePartitionSkew(profile: any, result: OptimizationRecommendation): void {
    const textProfile = profile.query_info?.text_profile || '';
    const lines = textProfile.split('\n');
    
    for (const line of lines) {
      const skewMatch = line.match(/max:(\d+) at partition_(\d+), average: (\d+)/);
      if (skewMatch) {
        const max = parseInt(skewMatch[1], 10);
        const partition = skewMatch[2];
        const avg = parseInt(skewMatch[3], 10);
        
        if (max > avg * 3) {
          result.suggestions.push({
            issue: `Significant data skew detected in partition ${partition}`,
            recommendation: 'Review your shard key choice and data distribution strategy to achieve more uniform load across partitions.',
            impact: 'high'
          });
        }
      }
    }
  }

  private identifyBottlenecks(profile: any, result: OptimizationRecommendation): void {
    const textProfile = profile.query_info?.text_profile || '';
    const lines = textProfile.split('\n');
    
    const execTimes: Array<{operation: string, time: number}> = [];
    
    for (const line of lines) {
      const execTimeMatch = line.match(/exec_time: (\d+)ms/);
      if (execTimeMatch) {
        const time = parseInt(execTimeMatch[1], 10);
        const operationMatch = line.match(/^(\w+)/);
        const operation = operationMatch ? operationMatch[1] : 'Unknown';
        execTimes.push({ operation, time });
      }
    }
    
    execTimes.sort((a, b) => b.time - a.time);
    
    result.summary.bottlenecks = execTimes
      .slice(0, 3)
      .filter(item => item.time > 0)
      .map(item => `${item.operation} (${item.time}ms)`);
  }

  private setupSseTransport(port: number) {
    try {
      log('Setting up SSE transport for MCP...');
      
      // Set up the root route
      this.app.get('/', (req, res) => {
        res.send('MCP SingleStore Server is running');
      });
      
      // Use middleware to parse JSON
      this.app.use(express.json());
      
      // Create the SSE paths
      const ssePath = '/sse';
      const messagePath = '/sse-messages';
      
      // Create the SSE transport
      this.sseTransport = new DirectSseTransport(this.app, ssePath, messagePath);
      
      // Set message handler
      this.sseTransport.onmessage = async (message) => {
        try {
          log('Received message from client:', message);
          
          // Pass the message to the MCP server
          if ((this.server as any).handleMessage) {
            (this.server as any).handleMessage(message);
          } else {
            log('Warning: Server has no handleMessage method');
          }
        } catch (error) {
          log('Error processing message:', error);
        }
      };
      
      // Connect the transport to the server
      try {
        this.server.connect(this.sseTransport as any);
        log('SSE transport connected to server successfully');
      } catch (error) {
        log('Error connecting SSE transport to server:', error);
      }
      
      // Start the HTTP server
      this.httpServer.listen(port, () => {
        log(`MCP SingleStore SSE server listening on port ${port}`);
        log('SSE transport routes set up successfully');
        log(`Access SSE endpoint at: http://localhost:${port}${ssePath}`);
        log(`Send JSON-RPC messages to: http://localhost:${port}${messagePath}`);
      });
    } catch (error) {
      log('Error setting up SSE transport:', error);
    }
  }

  private async startServer() {
    try {
      // Try to connect to the database first
      await this.ensureConnection();
      
      // Set up tool handlers
      this.setupToolHandlers();
      
      // Set up STDIO transport
      this.server.connect(new StdioServerTransport());
      log('STDIO transport connected');
      
      // Set up HTTP server for SSE
      const port = parseInt(process.env.MCP_SSE_PORT || '8080', 10);
      
      // Check if port is already in use before starting the server
      const isPortInUse = await new Promise((resolve) => {
        const tester = net.createServer()
          .once('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
              resolve(true);
            } else {
              resolve(false);
            }
          })
          .once('listening', () => {
            tester.once('close', () => resolve(false)).close();
          })
          .listen(port);
      });
      
      if (isPortInUse) {
        log(`ERROR: Port ${port} is already in use. This could be caused by:
1. Another instance of the server is already running
2. Another application is using this port
3. A previous instance of the server did not shut down properly

Try one of the following solutions:
- Change the port by setting MCP_SSE_PORT in your .env file
- Kill the process using port ${port} with: lsof -i :${port} | grep LISTEN
  Then kill the process with: kill -9 <PID>`);
        
        // Try to use an alternative port
        const alternativePort = port + 1;
        log(`Attempting to use alternative port ${alternativePort}...`);
        
        // Check if alternative port is available
        const isAltPortInUse = await new Promise((resolve) => {
          const tester = net.createServer()
            .once('error', (err: any) => {
              if (err.code === 'EADDRINUSE') {
                resolve(true);
              } else {
                resolve(false);
              }
            })
            .once('listening', () => {
              tester.once('close', () => resolve(false)).close();
            })
            .listen(alternativePort);
        });
        
        if (isAltPortInUse) {
          log(`Alternative port ${alternativePort} is also in use. Please set a different port in your .env file.`);
          return;
        }
        
        // Use the alternative port
        this.setupSseTransport(alternativePort);
      } else {
        // Use the original port
        this.setupSseTransport(port);
      }
    } catch (error) {
      log('Error starting server:', error);
      process.exit(1);
    }
  }

  async run() {
    await this.startServer();
  }
}

// Create and run the server
const server = new SingleStoreMcpServer();
server.run().catch(err => {
  log('Error starting server:', err);
  process.exit(1);
});