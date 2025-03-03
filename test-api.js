import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8081';

async function testServer() {
  try {
    console.log(`Testing connection to ${BASE_URL}`);
    const response = await fetch(BASE_URL);
    console.log(`Response status: ${response.status}`);
    console.log(`Response text: ${await response.text()}`);
    
    console.log(`
To connect to this server with the MCP Inspector:
1. Kill any running Inspector instances
2. Run the following command:
   npx @modelcontextprotocol/inspector connect --port 4000 --ui-port 6000 sse:http://localhost:8081
3. Or access the server directly at ${BASE_URL}/sse for SSE connections
4. Send messages to ${BASE_URL}/sse-messages with JSON-RPC format
`);
  } catch (error) {
    console.error(`Error connecting to server: ${error.message}`);
  }
}

testServer();