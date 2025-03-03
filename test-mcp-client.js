// Complete MCP client test with SSE
import * as EventSourceModule from 'eventsource';
const EventSource = EventSourceModule.default || EventSourceModule;
import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:8080';
let sessionId = null;

// Connect to SSE first
const es = new EventSource(`${SERVER_URL}/sse`);
console.log(`Connecting to SSE endpoint at ${SERVER_URL}/sse`);

es.onopen = () => {
  console.log('SSE connection established');
};

es.onmessage = async (event) => {
  try {
    const data = JSON.parse(event.data);
    console.log('Received SSE message:', data);
    
    // If this is a connection message, extract session ID if available
    if (data.type === 'connection' && data.status === 'connected') {
      sessionId = data.clientId || 'unknown';
      console.log(`Session ID: ${sessionId}`);
      
      // Now that we have a connection, list the tools
      await listTools();
    }
  } catch (error) {
    console.error('Error processing SSE message:', error);
  }
};

es.onerror = (error) => {
  console.error('SSE connection error:', error);
};

// Function to request the list of tools
async function listTools() {
  try {
    console.log(`Requesting tools from ${SERVER_URL}/sse-messages`);
    
    const response = await fetch(`${SERVER_URL}/sse-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'listTools',
        params: {}
      })
    });
    
    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(`Response: ${text}`);
      return;
    }
    
    const result = await response.json();
    console.log('Available tools:');
    console.log(JSON.stringify(result, null, 2));
    
    // Try calling a tool
    await callTool('list_tables', {});
  } catch (error) {
    console.error('Error listing tools:', error.message);
  }
}

// Function to call a specific tool
async function callTool(toolName, args) {
  try {
    console.log(`Calling tool '${toolName}' with args:`, args);
    
    const response = await fetch(`${SERVER_URL}/sse-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'callTool',
        params: {
          name: toolName,
          arguments: args,
          _meta: { 
            progressToken: sessionId 
          }
        }
      })
    });
    
    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.error(`Response: ${text}`);
      return;
    }
    
    const result = await response.json();
    console.log(`Tool '${toolName}' result:`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Error calling tool '${toolName}':`, error.message);
  }
}

// Keep the script running to receive SSE events
console.log('Waiting for SSE events. Press Ctrl+C to exit.');

// Cleanup function to close connections when the script exits
function cleanup() {
  console.log('Closing SSE connection...');
  es.close();
  process.exit();
}

// Listen for SIGINT to handle Ctrl+C
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Set a timeout to close after 30 seconds
setTimeout(() => {
  console.log('Test complete - 30 second timeout reached');
  cleanup();
}, 30000);