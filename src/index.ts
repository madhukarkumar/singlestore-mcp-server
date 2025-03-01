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

  private async analyzeProfileData(profileData: any, originalQuery: string): Promise<OptimizationRecommendation> {
    const result: OptimizationRecommendation = {
      summary: {
        total_runtime_ms: '0',
        compile_time_ms: '0',
        execution_time_ms: '0',
        bottlenecks: []
      },
      suggestions: []
    };

    try {
      // Parse the JSON string if it's not already an object
      const profile = typeof profileData === 'string' ? JSON.parse(profileData) : profileData;
      
      // Extract query_info
      const queryInfo = profile.query_info || {};
      
      // Set basic summary information
      result.summary.total_runtime_ms = queryInfo.total_runtime_ms || '0';
      
      // Extract compile time from compile_time_stats if available
      if (queryInfo.compile_time_stats && queryInfo.compile_time_stats.total) {
        result.summary.compile_time_ms = queryInfo.compile_time_stats.total;
        
        // Calculate execution time (total - compile)
        const totalTime = parseInt(result.summary.total_runtime_ms, 10);
        const compileTime = parseInt(result.summary.compile_time_ms, 10);
        result.summary.execution_time_ms = (totalTime - compileTime).toString();
      }

      // Analyze execution plan and operators
      this.analyzeExecutionPlan(profile, result);
      
      // Analyze table statistics and memory usage
      this.analyzeMemoryAndStats(profile, result);
      
      // Analyze network traffic and data movement
      this.analyzeNetworkTraffic(profile, result);
      
      // Analyze compilation time
      this.analyzeCompilationTime(profile, result);
      
      // Analyze partition skew
      this.analyzePartitionSkew(profile, result);
      
      // Identify bottlenecks
      this.identifyBottlenecks(profile, result);
      
    } catch (error) {
      result.suggestions.push({
        issue: 'Error analyzing profile data',
        recommendation: 'The profile data could not be properly analyzed. Please check the query syntax.',
        impact: 'high'
      });
    }
    
    return result;
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
              batch_size: {
                type: 'number',
                description: 'Number of rows to insert in each batch',
                default: 1000
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
              }
            },
            required: ['table']
          }
        },
        {
          name: 'optimize_sql',
          description: 'Analyze a SQL query using PROFILE and provide optimization recommendations',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'SQL query to analyze and optimize'
              }
            },
            required: ['query']
          }
        }
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

        case 'optimize_sql': {
          if (!request.params.arguments || typeof request.params.arguments.query !== 'string') {
            throw new McpError(
              ErrorCode.InvalidParams,
              'Query parameter must be a string'
            );
          }

          const query = request.params.arguments.query.trim();
          
          try {
            // Step 1: Run PROFILE on the query
            await conn.query('SET profile_for_debug = ON');
            await conn.query(`PROFILE ${query}`);
            
            // Step 2: Get the profile data in JSON format
            const [profileResult] = await conn.query('SHOW PROFILE JSON') as [mysql.RowDataPacket[], mysql.FieldPacket[]];
            
            // Step 3: Analyze the profile data and generate recommendations
            const recommendations = await this.analyzeProfileData(profileResult[0], query);
            
            // Step 4: Return the analysis and recommendations
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    original_query: query,
                    profile_summary: recommendations.summary,
                    recommendations: recommendations.suggestions,
                    optimized_query: recommendations.optimizedQuery || query
                  }, null, 2)
                }
              ]
            };
          } catch (error: unknown) {
            const err = error as Error;
            throw new McpError(
              ErrorCode.InternalError,
              `Query optimization error: ${err.message}`
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
