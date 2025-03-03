// Simple SSE client for testing MCP server
import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:8080';

async function main() {
  console.log(`Testing connection to ${SERVER_URL}`);
  
  // Check if server is responding
  try {
    const response = await fetch(SERVER_URL);
    console.log(`Server responded with status: ${response.status}`);
    console.log('Response:', await response.text());
  } catch (error) {
    console.error(`Error connecting to server: ${error.message}`);
    console.log('Please make sure the server is running on port 8080');
    return;
  }
  
  // To check available tools, we need to:
  // 1. Connect to the SSE endpoint
  // 2. Wait for the connection message
  // 3. Send a listTools request to the message endpoint
  
  console.log(`
To use the MCP server with SSE transport manually:

1. In a browser, navigate to http://localhost:8080 to verify the server is running
2. Use the MCP Inspector: npx @modelcontextprotocol/inspector connect sse:http://localhost:8080
3. If the Inspector doesn't work, you can test via curl:
   curl -X POST -H "Content-Type: application/json" \\
        -d '{"jsonrpc":"2.0","id":1,"method":"listTools","params":{}}' \\
        http://localhost:8080/sse-messages

Make sure the server is running and accessible from the network.
  `);
}

main();