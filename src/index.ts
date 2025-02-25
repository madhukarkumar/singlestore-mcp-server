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
import { randomBytes } from 'crypto';

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

interface ResultSetHeader extends mysql.OkPacket {
  affectedRows: number;
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

class SingleStoreServer {
  // Helper method to generate random values based on column type
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
        {
          name: 'create_table',
          description: 'Create a new table in the database with specified columns and constraints',
          inputSchema: {
            type: 'object',
            properties: {
              table_name: {
                type: 'string',
                description: 'Name of the table to create'
              },
              columns: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Column name'
                    },
                    type: {
                      type: 'string',
                      description: 'Data type (e.g., INT, VARCHAR(255), etc.)'
                    },
                    nullable: {
                      type: 'boolean',
                      description: 'Whether the column can be NULL'
                    },
                    default: {
                      type: 'string',
                      description: 'Default value for the column'
                    },
                    auto_increment: {
                      type: 'boolean',
                      description: 'Whether the column should auto increment'
                    }
                  },
                  required: ['name', 'type']
                },
                description: 'List of columns to create'
              },
              table_options: {
                type: 'object',
                properties: {
                  shard_key: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Columns to use as shard key'
                  },
                  sort_key: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Columns to use as sort key'
                  },
                  is_reference: {
                    type: 'boolean',
                    description: 'Whether this is a reference table'
                  },
                  compression: {
                    type: 'string',
                    enum: ['SPARSE'],
                    description: 'Table compression type'
                  },
                  auto_increment_start: {
                    type: 'number',
                    description: 'Starting value for auto increment columns'
                  }
                }
              }
            },
            required: ['table_name', 'columns']
          }
        },
        {
          name: 'generate_synthetic_data',
          description: 'Generate and insert synthetic data into an existing table',
          inputSchema: {
            type: 'object',
            properties: {
              table: {
                type: 'string',
                description: 'Name of the table to insert data into'
              },
              count: {
                type: 'number',
                description: 'Number of rows to generate and insert',
                default: 100
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
                      description: 'Type of generator to use'
                    },
                    start: {
                      type: 'number',
                      description: 'Starting value for sequence generator'
                    },
                    end: {
                      type: 'number',
                      description: 'Ending value for random number generator'
                    },
                    values: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Array of values to choose from for values generator'
                    },
                    formula: {
                      type: 'string',
                      description: 'SQL expression for formula generator'
                    }
                  }
                }
              },
              batch_size: {
                type: 'number',
                description: 'Number of rows to insert in each batch',
                default: 1000
              }
            },
            required: ['table']
          }
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
            ) as [TableRowDataPacket[], mysql.FieldPacket[]];

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
            throw new McpError(
              ErrorCode.InternalError,
              `Table description error: ${err.message}`
            );
          }
        }

        case 'create_table': {
          if (!request.params.arguments || !request.params.arguments.table_name || !Array.isArray(request.params.arguments.columns)) {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Invalid parameters for create_table'
            );
          }

          try {
            const { table_name, columns, table_options = {} } = request.params.arguments;
            
            // Start building the CREATE TABLE statement
            let sql = `CREATE ${table_options.is_reference ? 'REFERENCE ' : ''}TABLE ${table_name} (\n`;
            
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
            if (table_options.shard_key?.length) {
              columnDefs.push(`  SHARD KEY (${table_options.shard_key.join(', ')})`);
            }

            // Add sort key if specified
            if (table_options.sort_key?.length) {
              columnDefs.push(`  SORT KEY (${table_options.sort_key.join(', ')})`);
            }

            sql += columnDefs.join(',\n');
            sql += '\n)';

            // Add table options
            const tableOptions = [];
            if (table_options.compression === 'SPARSE') {
              tableOptions.push('COMPRESSION = SPARSE');
            }
            if (table_options.auto_increment_start) {
              tableOptions.push(`AUTO_INCREMENT = ${table_options.auto_increment_start}`);
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
                  text: `Table ${table_name} created successfully`
                }
              ]
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to create table: ${err.message}`
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

        case 'generate_synthetic_data': {
          if (!request.params.arguments || typeof request.params.arguments.table !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Table parameter must be a string'
            );
          }

          const table = request.params.arguments.table;
          const count = request.params.arguments.count || 100;
          const batchSize = Math.min(request.params.arguments.batch_size || 1000, 5000);
          const columnGenerators = request.params.arguments.column_generators || {};

          try {
            // Get table schema to understand column types
            const [columns] = await conn.query(
              'DESCRIBE ??',
              [table]
            ) as [ColumnRowDataPacket[], mysql.FieldPacket[]];

            if (columns.length === 0) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Table ${table} does not exist or has no columns`
              );
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
              throw new McpError(
                ErrorCode.InvalidParams,
                `Table ${table} has only auto-increment columns, cannot insert data`
              );
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
                    const generator = columnGenerators[columnName];
                    
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
                    rows_per_second: Math.round(totalInserted / duration)
                  }, null, 2)
                }
              ]
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to generate synthetic data: ${err.message}`
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
