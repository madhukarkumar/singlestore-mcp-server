// Script to list tools from MCP server
import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:8080';

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
  } catch (error) {
    console.error('Error:', error.message);
  }
}

listTools();