// Testing MCP server directly with JSON-RPC over HTTP
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8080';
const MESSAGE_ENDPOINT = `${BASE_URL}/sse-messages`;

// Function to send a JSON-RPC request to the SSE message endpoint
async function sendRequest(method, params = {}) {
  console.log(`Sending ${method} request to ${MESSAGE_ENDPOINT}`);
  
  try {
    const response = await fetch(MESSAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      })
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.error(`Error (${response.status}): ${text}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error sending request: ${error.message}`);
    return null;
  }
}

// Test the connection by sending a listTools request
async function testConnection() {
  console.log('Testing MCP server connection...');
  
  // First, check if the server is running
  try {
    const response = await fetch(BASE_URL);
    console.log(`Server status: ${response.status} ${response.statusText}`);
  } catch (error) {
    console.error(`Cannot connect to server: ${error.message}`);
    return;
  }
  
  // Then try to list tools
  const tools = await sendRequest('listTools');
  if (tools) {
    console.log('Available tools:');
    console.log(JSON.stringify(tools, null, 2));
  } else {
    console.log('Failed to get tool list');
  }
}

// Call the test function
testConnection();