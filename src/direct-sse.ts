// Direct SSE implementation that closely matches the SDK
import { EventEmitter } from 'events';
import * as express from 'express';
import { Request, Response, Application } from 'express';

// Simple logger function
const log = (message: string, ...args: any[]) => {
  if (args.length === 0) {
    process.stderr.write(`${message}\n`);
  } else {
    const formattedArgs = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    process.stderr.write(`${message} ${formattedArgs}\n`);
  }
};

// Simple SSE client connection
class SseClient {
  id: string;
  res: Response;
  private pingInterval: NodeJS.Timeout;
  private connected: boolean = true;
  
  constructor(id: string, res: Response) {
    this.id = id;
    this.res = res;
    
    // Set SSE headers with specific values for EventSource compatibility
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no' // Important for NGINX
    });
    
    // First send a comment as a keepalive packet to establish connection
    try {
      res.write(': welcome\n\n');
    } catch (err) {
      log(`Error sending welcome message to client ${id}:`, err);
      this.connected = false;
      return;
    }
    
    // Send initial connected message as proper SSE event
    const connectMsg = JSON.stringify({ type: 'connection', status: 'connected', clientId: id });
    try {
      res.write(`data: ${connectMsg}\n\n`);
      log(`Sent connection message to client ${id}`);
    } catch (err) {
      log(`Error sending connection message to client ${id}:`, err);
      this.connected = false;
      return;
    }
    
    // Setup short interval ping to keep connection alive (every 10 seconds)
    this.pingInterval = setInterval(() => {
      if (!this.connected || res.writableEnded || res.destroyed) {
        clearInterval(this.pingInterval);
        this.connected = false;
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch (err) {
        log(`Error sending ping to client ${id}:`, err);
        clearInterval(this.pingInterval);
        this.connected = false;
      }
    }, 10000); // More frequent pings to keep connection alive
    
    // Handle connection close
    res.on('close', () => {
      clearInterval(this.pingInterval);
      this.connected = false;
      log(`SSE client ${id} disconnected`);
    });
    
    // Handle errors
    res.on('error', (err) => {
      clearInterval(this.pingInterval);
      this.connected = false;
      log(`SSE client ${id} error:`, err);
    });
  }
  
  // Send data to client
  send(data: any): void {
    if (!this.connected || this.res.writableEnded || this.res.destroyed) {
      log(`Cannot send to client ${this.id} - connection closed`);
      return;
    }
    
    try {
      // Convert to string if needed
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      
      // Write with proper SSE format
      this.res.write(`data: ${message}\n\n`);
      
      // Log brief version of sent message (for debugging)
      const shortMsg = message.length > 100 ? message.substring(0, 100) + '...' : message;
      log(`Sent message to client ${this.id}: ${shortMsg}`);
    } catch (err) {
      log(`Error sending to client ${this.id}:`, err);
      this.connected = false;
    }
  }
  
  // Close the connection
  close(): void {
    this.connected = false;
    clearInterval(this.pingInterval);
    
    if (!this.res.writableEnded && !this.res.destroyed) {
      try {
        // Send a final message before closing
        this.res.write(`data: ${JSON.stringify({type: 'disconnect'})}\n\n`);
        this.res.end();
        log(`Closed connection to client ${this.id}`);
      } catch (err) {
        log(`Error closing client ${this.id}:`, err);
      }
    }
  }
  
  // Check if client is still connected
  isConnected(): boolean {
    return this.connected && !this.res.writableEnded && !this.res.destroyed;
  }
}

// SSE Server Transport for MCP
export class DirectSseTransport extends EventEmitter {
  private endpoint: string;
  private messagePath: string;
  private clients: Map<string, SseClient> = new Map();
  private app: Application;
  public onmessage: ((message: any) => void) | null = null;

  constructor(app: Application, endpoint: string, messagePath: string) {
    super();
    this.app = app;
    this.endpoint = endpoint;
    this.messagePath = messagePath;
    // Routes will be set up in start()
  }
  
  // Start method required by MCP SDK
  async start(): Promise<void> {
    log('Starting SSE transport');
    this.setupRoutes();
    return Promise.resolve();
  }
  
  private setupRoutes() {
    // SSE endpoint for client connections
    this.app.get(this.endpoint, (req, res) => {
      const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      log(`New SSE client connected: ${clientId}`);
      
      // Create and store client
      const client = new SseClient(clientId, res);
      this.clients.set(clientId, client);
      
      // Handle client disconnect
      req.on('close', () => {
        this.clients.delete(clientId);
        log(`SSE client removed: ${clientId}`);
      });
    });
    
    // Message endpoint for receiving client commands
    this.app.post(this.messagePath, express.json(), (req, res) => {
      log('Received message:', req.body);
      
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ error: 'Invalid message format' });
      }
      
      // Handle the message
      try {
        // For debugging - log the entire message
        log('Incoming JSON-RPC request:', JSON.stringify(req.body));
        
        // Forward the message to any listeners
        if (this.onmessage) {
          // Call onmessage handler with the request
          this.onmessage(req.body);
          
          // If this is a listTools request, log it specifically
          if (req.body.method === 'listTools') {
            log('Received listTools request with id:', req.body.id);
          }
        } else {
          log('Warning: No onmessage handler set for processing messages');
        }
        
        // Also emit as an event for legacy support
        this.emit('message', req.body);
        
        // Return a valid JSON-RPC response
        res.status(200).json({
          jsonrpc: '2.0',
          id: req.body.id,
          result: { success: true }
        });
      } catch (err) {
        log('Error processing message:', err);
        res.status(500).json({ 
          jsonrpc: '2.0',
          id: req.body.id,
          error: {
            code: -32000,
            message: 'Error processing message'
          }
        });
      }
    });
  }
  
  // Send message to all clients
  async send(message: any): Promise<void> {
    // Count active clients
    const activeClients = [...this.clients.values()].filter(c => c.isConnected());
    
    if (activeClients.length === 0) {
      log('No connected clients to send message to');
      return;
    }
    
    // Log verbose information about what we're sending
    log(`Sending message to ${activeClients.length} clients`);
    
    // Special handling for tool list responses
    const parsed = typeof message === 'string' ? JSON.parse(message) : message;
    if (parsed && parsed.result && parsed.result.tools) {
      const toolNames = parsed.result.tools.map((t: any) => t.name).join(', ');
      log(`Sending tools list: [${toolNames}]`);
    }
    
    // Send to all active clients
    for (const client of activeClients) {
      client.send(message);
    }
    
    // Clean up any disconnected clients
    this.cleanupClients();
  }
  
  // Periodically clean up disconnected clients
  private cleanupClients(): void {
    let disconnectedCount = 0;
    
    for (const [id, client] of this.clients.entries()) {
      if (!client.isConnected()) {
        this.clients.delete(id);
        disconnectedCount++;
      }
    }
    
    if (disconnectedCount > 0) {
      log(`Cleaned up ${disconnectedCount} disconnected clients. Remaining: ${this.clients.size}`);
    }
  }
  
  // Send to a specific client
  sendToClient(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.send(message);
    }
  }
  
  // Close all connections
  close(): void {
    log('Closing all SSE connections');
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
    this.removeAllListeners();
  }
  
  // Get number of connected clients
  getClientCount(): number {
    return this.clients.size;
  }
}