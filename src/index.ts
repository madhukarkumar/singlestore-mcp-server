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
import * as http from 'http';
import { randomBytes } from 'crypto';
import express from 'express';
import cors from 'cors';

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

// Interface for SSE client connection management
interface SseClient {
  id: string;
  response: express.Response;
}

class SingleStoreServer {
  // Array to track SSE client connections
  private sseClients: SseClient[] = [];
  // HTTP server for SSE support
  private httpServer: http.Server | null = null;
  private ssePort: number = parseInt(process.env.MCP_SSE_PORT || process.env.SSE_PORT || '8081');
  
  // Track the actual port we're using (in case the preferred port is unavailable)
  private actualSsePort: number = this.ssePort;
  
  // Store the list tools response
  private cachedTools: any = null;

  // Helper method to handle requests directly
  private async handleRequest(schema: any, request: any): Promise<any> {
    if (schema === ListToolsRequestSchema) {
      // Return cached tools list if available
      if (this.cachedTools) {
        return this.cachedTools;
      }
      
      // Create a tools list by reading from the setupToolHandlers method
      // This is a simplified version for the SSE API
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
          // Add other tools - this would ideally be dynamically generated
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
            description: 'Create a new table with specified columns',
            inputSchema: {
              type: 'object',
              properties: {
                table_name: { type: 'string' },
                columns: { type: 'array' }
              },
              required: ['table_name', 'columns'],
            },
          },
          {
            name: 'generate_synthetic_data',
            description: 'Generate synthetic data for a table',
            inputSchema: {
              type: 'object',
              properties: {
                table: { type: 'string' },
                count: { type: 'number' }
              },
              required: ['table'],
            },
          },
          {
            name: 'optimize_sql',
            description: 'Analyze and optimize SQL queries',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query'],
            },
          }
        ],
      };
    } else if (schema === CallToolRequestSchema) {
      // For tool calls, we need to delegate to the main server's handler
      // To avoid complex IPC, we'll implement a direct call to the handler
      
      // Check if this is a valid tool
      if (!request.params || !request.params.name) {
        throw new McpError(ErrorCode.InvalidParams, 'Tool name is required');
      }
      
      // Ensure we have a database connection
      await this.ensureConnection();
      
      // Process the request directly using our tool implementation logic
      switch (request.params.name) {
        case 'list_tables':
          // Call the same implementation as in setupToolHandlers
          const conn = await this.ensureConnection();
          const [rows] = await conn.query('SHOW TABLES') as [mysql.RowDataPacket[], mysql.FieldPacket[]];
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(rows, null, 2),
              },
            ],
          };
        
        // For other tools, we need to delegate to the appropriate handler
        // This implementation is simplified for demonstration purposes
        // In a production scenario, you'd refactor the handlers to be reusable
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Tool ${request.params.name} implementation not available via SSE API yet`
          );
      }
    } else {
      throw new Error('Unknown schema');
    }
  }

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
  private app: express.Application;

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
    
    // Initialize Express for SSE endpoint
    this.app = express();
    
    // Configure CORS for all routes
    this.app.use(cors({
      origin: '*', // Allow all origins
      methods: ['GET', 'POST', 'OPTIONS'], // Allowed methods
      allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
      credentials: true // Allow cookies
    }));
    
    // Handle preflight requests
    this.app.options('*', cors());
    
    // Parse JSON in request body
    this.app.use(express.json());
    
    // Log all requests for debugging
    this.app.use((req, res, next) => {
      console.error(`[SSE] ${req.method} request to ${req.path} from ${req.ip}`);
      next();
    });
    
    // Set up SSE endpoints
    this.setupSseEndpoints();
    
    // Dedicated endpoint for MCP Inspector - more compatible implementation
    this.app.get('/stream', (req, res) => {
      console.error('[SSE] Stream endpoint accessed directly');
      try {
        const clientId = randomBytes(16).toString('hex');
        
        // Set headers for SSE - using Express's type-specific method
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        
        console.error(`[SSE] Stream headers set directly with writeHead`);
        
        // Log what we sent
        console.error(`[SSE] Content-Type sent: ${res.getHeader('Content-Type')}`);
        
        // Initial message
        res.write(`data: ${JSON.stringify({ type: 'connection_established', clientId })}\n\n`);
        
        // Store client
        this.sseClients.push({ id: clientId, response: res });
        
        // Ping loop
        const pingInterval = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch (error) {
            clearInterval(pingInterval);
          }
        }, 30000);
        
        // Handle disconnect
        req.on('close', () => {
          clearInterval(pingInterval);
          this.sseClients = this.sseClients.filter(client => client.id !== clientId);
        });
      } catch (error) {
        console.error(`[SSE] Error in stream endpoint: ${error}`);
        res.status(500).send('Error setting up SSE stream');
      }
    });
    
    // Special connection endpoint for MCP Inspector specifically
    this.app.get('/connect', (req, res) => {
      console.error('[SSE] Connect endpoint accessed - standard MCP Inspector endpoint');
      
      // Set transport-specific options
      const transportType = req.query.transportType || 'sse';
      console.error(`[SSE] Connect request with transport type: ${transportType}`);
      
      // If it's an SSE request, redirect to the stream endpoint
      if (transportType === 'sse') {
        const streamUrl = `/stream${req.query.url ? `?url=${req.query.url}` : ''}`;
        console.error(`[SSE] Redirecting to stream endpoint: ${streamUrl}`);
        return res.redirect(307, streamUrl);
      }
      
      // Otherwise respond with connection info
      res.status(200).json({
        connected: true,
        transportType: transportType,
        server: 'SingleStore MCP Server'
      });
    });
    
    // Alternative dedicated MCP Inspector endpoint
    this.app.get('/mcp-sse', (req, res) => {
      console.error('[SSE] MCP-SSE endpoint accessed directly');
      
      // Set the necessary headers
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      
      // Send a 200 OK response
      res.status(200);
      
      // Manually flush the headers to ensure they are sent
      res.write(''); // This forces the headers to be sent
      
      // Send an initial event
      res.write('data: {"connected":true}\n\n');
      
      // Set up a keepalive interval
      const keepAliveInterval = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 15000);
      
      // Handle client disconnect
      req.on('close', () => {
        clearInterval(keepAliveInterval);
      });
    });
    
    // Handle cleanup on process termination
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }
  
  // Setup SSE endpoints
  private setupSseEndpoints() {
    // Root endpoint
    this.app.get('/', (req, res) => {
      // Log connection details for debugging
      console.error(`[SSE] Root endpoint accessed from ${req.ip} with headers:`, req.headers);
      
      // Special handling for MCP Inspector
      const isMcpInspector = req.headers['user-agent']?.includes('node');
      
      if (isMcpInspector) {
        console.error('[SSE] Detected MCP Inspector request');
        // Return MCP server metadata in the format expected by MCP Inspector
        return res.status(200).json({
          jsonrpc: '2.0',
          result: {
            name: 'SingleStore MCP Server',
            version: '0.1.0',
            capabilities: {
              tools: {},
              transportTypes: ['sse']
            }
          }
        });
      }
      
      // Standard response for other clients
      const serverInfo = {
        name: 'SingleStore MCP Server',
        version: '0.1.0',
        status: 'running',
        port: this.actualSsePort,
        address: this.httpServer?.address(),
        clientIP: req.ip,
        server_time: new Date().toISOString(),
        sse_url: `http://localhost:${this.actualSsePort}/sse`,
        stream_url: `http://localhost:${this.actualSsePort}/stream`,
        endpoints: {
          '/': 'Server information',
          '/health': 'Health check',
          '/sse': 'SSE connection endpoint',
          '/stream': 'Alternative SSE endpoint (for MCP Inspector)',
          '/tools': 'List available tools',
          '/call-tool': 'Call a tool (POST)'
        }
      };
      
      console.error(`[INFO] Server info requested - Port: ${this.actualSsePort}`);
      res.status(200).json(serverInfo);
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok' });
    });
    
    // Direct SSE endpoint for MCP Inspector
    this.app.get('/sse', (req, res) => {
      try {
        const clientId = randomBytes(16).toString('hex');
        const transportType = req.query.transportType || 'sse';
        const url = req.query.url || 'not provided';
        
        // Log connection attempt with detailed information
        console.error(`[SSE] Connection attempt from ${req.ip} with transport ${transportType}`);
        console.error(`[SSE] Query parameters:`, req.query);
        console.error(`[SSE] Headers:`, req.headers);
        
        // Debug: Check headers that are being used in the client's EventSource constructor
        if (req.headers['accept']) {
          console.error(`[SSE] Accept header: ${req.headers['accept']}`);
        }
        
        // Add CORS preflight response for OPTIONS requests
        if (req.method === 'OPTIONS') {
          res.status(204).end();
          return;
        }
        
        // Reset headers to avoid any conflicts
        res.removeHeader('Content-Type');
        
        // CRITICAL: Set Content-Type header FIRST before any writes - using the most direct method
        res.header('Content-Type', 'text/event-stream');
        
        // CORS headers
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type');
        
        // SSE headers
        res.header('Cache-Control', 'no-cache');
        res.header('Connection', 'keep-alive');
        res.header('X-Accel-Buffering', 'no');
        
        // Force status code 200 before sending any data
        res.status(200);
        
        // DEBUG: Log the content-type we're actually setting
        console.error(`[SSE] Set Content-Type header: ${res.getHeader('Content-Type')}`);
        
        // Force flush headers before writing data
        res.flushHeaders();
        
        // Send initial connection message in proper SSE format
        // The first event must not have an event name for compatibility with some clients
        res.write(`data: ${JSON.stringify({ type: 'connection_established', clientId })}\n\n`);
        
        // Then send an explicit open event
        res.write(`event: open\ndata:\n\n`);
        
        // Mandatory ping for MCP inspector compatibility
        const pingInterval = setInterval(() => {
          try {
            res.write(": ping\n\n");
          } catch (error) {
            console.error(`[SSE] Error sending ping to client ${clientId}:`, error);
            clearInterval(pingInterval);
          }
        }, 30000);
        
        // Add client to active connections
        this.sseClients.push({ id: clientId, response: res });
        
        // Handle client disconnect
        req.on('close', () => {
          clearInterval(pingInterval);
          this.sseClients = this.sseClients.filter(client => client.id !== clientId);
          console.error(`[SSE] Client ${clientId} disconnected, ${this.sseClients.length} clients remaining`);
        });
        
        console.error(`[SSE] Client ${clientId} connected, total clients: ${this.sseClients.length}`);
      } catch (error) {
        console.error('[SSE] Error establishing connection:', error);
        res.status(500).send('Error establishing SSE connection');
      }
    });
    
    // Endpoint to list available tools - supports both GET and POST for MCP inspector
    this.app.get('/tools', async (req, res) => {
      try {
        const result = await this.handleRequest(ListToolsRequestSchema, {});
        res.status(200).json(result);
      } catch (error) {
        const err = error as Error;
        res.status(500).json({ 
          error: { 
            code: ErrorCode.InternalError, 
            message: err.message || 'Failed to list tools'
          }
        });
      }
    });
    
    // Support POST requests from MCP inspector for listing tools
    this.app.post('/tools', async (req, res) => {
      try {
        // Check if this is an MCP Inspector format request
        if (req.body.method === 'mcp.list_tools') {
          const result = await this.handleRequest(ListToolsRequestSchema, {});
          res.status(200).json({
            jsonrpc: '2.0',
            id: req.body.id || 'list-tools-response',
            result
          });
        } else {
          // Handle custom format
          const result = await this.handleRequest(ListToolsRequestSchema, {});
          res.status(200).json(result);
        }
      } catch (error) {
        const err = error as Error;
        const mcpError = err instanceof McpError ? err : 
                        new McpError(ErrorCode.InternalError, err.message);
        
        if (req.body.method === 'mcp.list_tools') {
          res.status(500).json({
            jsonrpc: '2.0',
            id: req.body.id || 'list-tools-error',
            error: {
              code: mcpError.code || ErrorCode.InternalError,
              message: mcpError.message || 'Failed to list tools'
            }
          });
        } else {
          res.status(500).json({ 
            error: { 
              code: mcpError.code || ErrorCode.InternalError, 
              message: mcpError.message || 'Failed to list tools'
            }
          });
        }
      }
    });
    
    // Endpoint to call a tool
    this.app.post('/call-tool', async (req, res) => {
      try {
        // Support both MCP Inspector format and our custom format
        let toolRequest;
        
        // Check if this is an MCP Inspector format request
        if (req.body.method === 'mcp.call_tool' && req.body.params) {
          // Standard MCP format via HTTP
          toolRequest = {
            params: req.body.params
          };
          console.error('[SSE] Received MCP Inspector format tool request:', req.body.params.name);
        } else {
          // Our custom format
          const { name, arguments: args, client_id } = req.body;
          
          if (!name) {
            return res.status(400).json({ 
              error: { 
                code: ErrorCode.InvalidParams,
                message: 'Tool name is required' 
              }
            });
          }
          
          toolRequest = {
            params: {
              name,
              arguments: args || {}
            }
          };
          console.error(`[SSE] Received custom format tool request: ${name}`);
        }
        
        // Get client_id from either format
        const client_id = req.body.client_id || 
                        (req.body.params && req.body.params._meta && req.body.params._meta.client_id);
        
        // Find if there's a specific client to send the response to
        const targetClient = client_id ? 
          this.sseClients.find(client => client.id === client_id) : 
          null;
        
        // If specific client requested but not found
        if (client_id && !targetClient) {
          return res.status(404).json({ 
            error: { 
              code: ErrorCode.InvalidParams,
              message: 'Client not found' 
            }
          });
        }
        
        // For immediate response without streaming
        if (!targetClient) {
          try {
            const result = await this.handleRequest(CallToolRequestSchema, toolRequest);
            
            // Return in MCP format if the request was in MCP format
            if (req.body.method === 'mcp.call_tool') {
              return res.status(200).json({
                jsonrpc: '2.0',
                id: req.body.id || 'call-tool-response',
                result
              });
            } else {
              return res.status(200).json(result);
            }
          } catch (error) {
            const err = error as Error;
            const mcpError = err instanceof McpError ? err : 
                            new McpError(ErrorCode.InternalError, err.message);
            
            // Return in MCP format if the request was in MCP format
            if (req.body.method === 'mcp.call_tool') {
              return res.status(500).json({
                jsonrpc: '2.0',
                id: req.body.id || 'call-tool-error',
                error: {
                  code: mcpError.code || ErrorCode.InternalError,
                  message: mcpError.message
                }
              });
            } else {
              return res.status(500).json({ 
                error: {
                  code: mcpError.code || ErrorCode.InternalError,
                  message: mcpError.message
                }
              });
            }
          }
        }
        
        // For streaming response via SSE
        res.status(202).json({ message: 'Request accepted for streaming' });
        
        // Start executing the tool and stream results
        this.executeToolWithStreaming(toolRequest, targetClient);
      } catch (error) {
        const err = error as Error;
        const mcpError = err instanceof McpError ? err : 
                        new McpError(ErrorCode.InternalError, err.message);
        
        res.status(500).json({ 
          error: {
            code: mcpError.code || ErrorCode.InternalError,
            message: mcpError.message
          }
        });
      }
    });
  }
  
  // Execute a tool and stream results to the specified SSE client
  private async executeToolWithStreaming(request: any, client: SseClient) {
    try {
      // Extract the request ID (if provided) or generate a new one
      let requestId = '';
      
      if (request.id) {
        // If request has an ID directly (our custom format)
        requestId = request.id;
      } else if (request.params && request.params._meta && request.params._meta.id) {
        // If request is in MCP format with ID in _meta
        requestId = request.params._meta.id;
      } else {
        // Generate a new ID if none was provided
        requestId = randomBytes(8).toString('hex');
      }
      
      console.error(`[SSE] Executing tool ${request.params.name} with request ID ${requestId}`);
      
      // Send start event - use the message format expected by MCP Inspector
      this.sendSseEvent(client, 'message', {
        jsonrpc: '2.0',
        method: 'mcp.call_tool.update',
        params: {
          status: 'started',
          name: request.params.name,
          arguments: request.params.arguments || {},
          timestamp: new Date().toISOString()
        }
      });
      
      // Execute the tool
      const result = await this.handleRequest(CallToolRequestSchema, request);
      
      console.error(`[SSE] Tool execution completed for ${request.params.name}`);
      
      // Send result event in MCP format
      this.sendSseEvent(client, 'message', {
        jsonrpc: '2.0',
        id: requestId,
        result: result
      });
    } catch (error) {
      const err = error as Error;
      const mcpError = err instanceof McpError ? err : 
                      new McpError(ErrorCode.InternalError, err.message);
      
      console.error(`[SSE] Tool execution error for ${request.params.name}: ${mcpError.message}`);
      
      // Send error event in MCP format
      this.sendSseEvent(client, 'message', {
        jsonrpc: '2.0',
        id: request.id || randomBytes(8).toString('hex'),
        error: {
          code: mcpError.code || ErrorCode.InternalError,
          message: mcpError.message
        }
      });
    }
  }
  
  // Send an event to a specific SSE client
  private sendSseEvent(client: SseClient, event: string, data: any) {
    try {
      // Ensure client response is still writable
      if (!client.response.writableEnded) {
        // Format according to the SSE standard
        const jsonData = JSON.stringify(data);
        console.error(`[SSE] Sending event ${event} to client ${client.id} (data length: ${jsonData.length})`);
        
        // For MCP Inspector compatibility, properly format the message
        if (jsonData.length > 16384) {
          // For large payloads, first send the event type
          client.response.write(`event: ${event}\n`);
          
          // Then split the data into chunks
          let i = 0;
          while (i < jsonData.length) {
            const chunk = jsonData.slice(i, i + 16384);
            client.response.write(`data: ${chunk}\n`);
            i += 16384;
          }
          
          // End with a blank line
          client.response.write('\n');
        } else {
          // Standard format for normal-sized messages
          client.response.write(`event: ${event}\n`);
          client.response.write(`data: ${jsonData}\n\n`);
        }
        
        console.error(`[SSE] Sent ${event} event to client ${client.id}`);
      } else {
        console.error(`[SSE] Cannot send event to client ${client.id}: connection closed`);
      }
    } catch (error) {
      console.error(`[SSE] Error sending event to client ${client.id}:`, error);
    }
  }
  
  // Broadcast an event to all connected SSE clients
  private broadcastSseEvent(event: string, data: any) {
    console.error(`[SSE] Broadcasting ${event} to ${this.sseClients.length} clients`);
    this.sseClients.forEach(client => {
      this.sendSseEvent(client, event, data);
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
    
    // Close HTTP server if running
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer?.close(() => resolve());
      });
    }
    
    // Close MCP server
    await this.server.close();
    
    // Clean up SSE clients
    this.sseClients.forEach(client => {
      try {
        client.response.end();
      } catch (error) {
        console.error(`[SSE] Error closing client ${client.id}:`, error);
      }
    });
    this.sseClients = [];
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
    // Start the Standard MCP server over stdio for traditional MCP tools
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('STDIO transport connected');
    
    // Start the HTTP server for SSE if SSE_ENABLED is set
    if (process.env.SSE_ENABLED === 'true') {
      try {
        this.httpServer = http.createServer(this.app);
        
        // Try to start the server on the configured port
        await new Promise<void>((resolve, reject) => {
          this.httpServer?.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
              console.error(`ERROR: Port ${this.ssePort} is already in use. This could be caused by:
1. Another instance of the server is already running
2. Another application is using this port
3. A previous instance of the server did not shut down properly

Try one of the following solutions:
- Change the port by setting MCP_SSE_PORT in your .env file
- Kill the process using port ${this.ssePort} with: lsof -i :${this.ssePort} | grep LISTEN
  Then kill the process with: kill -9 <PID>`);
              
              // Try an alternative port
              const alternativePort = this.ssePort + 1;
              console.error(`Attempting to use alternative port ${alternativePort}...`);
              
              this.httpServer?.removeAllListeners('error');
              this.httpServer?.listen(alternativePort, '0.0.0.0', () => {
                // Update the actual port to the alternative
                this.actualSsePort = alternativePort;
                console.error(`Setting up SSE transport for MCP...`);
                console.error(`Starting SSE transport`);
                console.error(`SSE transport connected to server successfully`);
                console.error(`MCP SingleStore SSE server listening on port ${this.actualSsePort}`);
                console.error(`SSE transport routes set up successfully`);
                console.error(`Access SSE endpoint at: http://localhost:${this.actualSsePort}/sse`);
                console.error(`MCP Inspector compatible endpoints:`);
                console.error(`  - http://localhost:${this.actualSsePort}/connect?transportType=sse`);
                console.error(`  - http://localhost:${this.actualSsePort}/stream`);
                console.error(`  - http://localhost:${this.actualSsePort}/mcp-sse`);
                console.error(`Send JSON-RPC messages to: http://localhost:${this.actualSsePort}/sse-messages`);
                resolve();
              });
            } else {
              reject(err);
            }
          });
          
          // Listen on all network interfaces (0.0.0.0) instead of just localhost
          this.httpServer?.listen(this.ssePort, '0.0.0.0', () => {
            this.actualSsePort = this.ssePort;
            console.error(`MCP SingleStore SSE server listening on port ${this.actualSsePort}`);
            console.error(`Access SSE endpoint at: http://localhost:${this.actualSsePort}/sse`);
            console.error(`MCP Inspector compatible endpoints:`);
            console.error(`  - http://localhost:${this.actualSsePort}/connect?transportType=sse`);
            console.error(`  - http://localhost:${this.actualSsePort}/stream`);
            console.error(`  - http://localhost:${this.actualSsePort}/mcp-sse`);
            console.error(`Send JSON-RPC messages to: http://localhost:${this.actualSsePort}/sse-messages`);
            resolve();
          });
        });
      } catch (error) {
        console.error('[SSE] Failed to start HTTP server:', error);
      }
    }
  }
}

const server = new SingleStoreServer();
server.run().catch(console.error);
