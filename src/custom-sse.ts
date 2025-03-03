// Custom implementation of SSE transport
import { EventEmitter } from 'events';
import { Request, Response } from 'express';

// Simple logger function
const log = (message: string, ...args: any[]) => {
  if (args.length === 0) {
    process.stderr.write(`${message}\n`);
  } else {
    let formattedArgs = args
      .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
      .join(' ');
    process.stderr.write(`${message} ${formattedArgs}\n`);
  }
};

// Define the necessary interfaces for compatibility with Server
export interface TransportMessage {
  jsonrpc: string;
  [key: string]: any;
}

// Create a custom transport that mimics the SDK's transport interface
export class CustomSseTransport extends EventEmitter {
  private res: Response;
  private connected: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageEndpoint: string;
  private jsonRpcHandlers: Map<string, Function> = new Map();
  
  // Required properties to be compatible with MCP Server transport
  public readonly type = 'sse';
  public onmessage: ((message: TransportMessage) => void) | null = null;

  constructor(messageEndpoint: string, res: Response) {
    super();
    this.res = res;
    this.messageEndpoint = messageEndpoint;
    
    // Handle connection setup immediately, wrap in try/catch to prevent top-level errors
    try {
      this.setupConnection();
    } catch (error) {
      log('Error in SSE connection setup:', error);
    }
  }

  private async setupConnection() {
    if (this.res.headersSent) {
      log('Headers already sent, cannot set up SSE connection');
      return;
    }

    try {
      // Set SSE headers
      this.res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no', // For nginx proxying
      });

      // First mark as connected so the send method can work
      this.connected = true;

      // Send initial connection message directly to avoid using the send method too early
      try {
        this.res.write(`data: ${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notification',
          params: {
            type: 'connection',
            status: 'connected',
          }
        })}\n\n`);
      } catch (error) {
        log('Error sending initial connection message:', error);
        this.connected = false;
        return;
      }

      // Set up heartbeat
      this.heartbeatInterval = setInterval(() => {
        try {
          if (!this.connected || this.res.writableEnded) {
            if (this.heartbeatInterval) {
              clearInterval(this.heartbeatInterval);
              this.heartbeatInterval = null;
            }
            return;
          }

          // Send heartbeat comment (not a message, just a comment to keep connection alive)
          this.res.write(': heartbeat\n\n');
        } catch (error) {
          log('Error sending heartbeat:', error);
          this.close();
        }
      }, parseInt(process.env.SSE_KEEPALIVE_INTERVAL_MS || '30000', 10));
    } catch (error) {
      log('Error setting up SSE connection:', error);
      this.connected = false;
    }
  }

  // Handler for incoming JSON-RPC request messages
  public handleRequest(req: Request, res: Response) {
    if (!this.connected) {
      return res.status(503).json({
        jsonrpc: '2.0',
        id: req.body.id,
        error: {
          code: -32000,
          message: 'SSE connection not established',
        },
      });
    }

    try {
      const message = req.body;

      // Validate the message format
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.method !== 'string' ||
        typeof message.jsonrpc !== 'string' ||
        message.jsonrpc !== '2.0'
      ) {
        return res.status(400).json({
          jsonrpc: '2.0',
          id: message?.id,
          error: {
            code: -32600,
            message: 'Invalid Request',
          },
        });
      }

      // Check if we have a handler for this method
      log(`Received JSON-RPC request: ${message.method}`);

      // Emit message event for listeners
      this.emit('message', message);
      
      // If onmessage handler is defined, call it directly
      if (this.onmessage) {
        this.onmessage(message);
      }

      // Always respond with success - actual processing happens asynchronously
      return res.status(200).json({
        jsonrpc: '2.0',
        id: message.id,
        result: { success: true },
      });
    } catch (error) {
      log('Error handling message:', error);
      return res.status(500).json({
        jsonrpc: '2.0',
        id: req.body?.id,
        error: {
          code: -32000,
          message: 'Internal error processing message',
        },
      });
    }
  }

  // Send a message over the SSE connection
  public send(data: any): Promise<void> {
    return new Promise((resolve) => {
      // Check connection status before attempting to send
      if (!this.connected) {
        log('Cannot send message - SSE connection not established');
        return resolve(); // Don't reject, just return silently
      }
      
      if (this.res.writableEnded) {
        log('Cannot send message - SSE connection closed');
        return resolve(); // Don't reject, just return silently
      }

      try {
        // Format as SSE data
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        this.res.write(`data: ${message}\n\n`);
        
        // For debugging
        log('Sent SSE message: ' + message.substring(0, 100) + (message.length > 100 ? '...' : ''));
        
        resolve();
      } catch (error) {
        log('Error sending SSE message:', error);
        // Don't reject on error - just log and continue
        resolve();
      }
    });
  }

  // Close the SSE connection
  public close() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.connected = false;
    
    // Only attempt to end the response if it hasn't been ended already
    if (!this.res.writableEnded) {
      try {
        this.res.end();
      } catch (error) {
        log('Error closing SSE connection:', error);
      }
    }

    this.emit('close');
  }
}