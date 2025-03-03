// Simple client to test SSE connection to MCP server
import fetch from 'node-fetch';
import EventSource from 'eventsource';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:8081';

async function testConnection() {
  console.log(`Testing connection to MCP server at ${SERVER_URL}`);
  
  try {
    // Test basic connectivity
    const response = await fetch(`${SERVER_URL}/`);
    const text = await response.text();
    console.log('Basic connection test:', response.status === 200 ? 'SUCCESS' : 'FAILED');
    console.log('Response:', text);
    
    // Test SSE endpoint
    console.log('\nInitiating SSE connection...');
    
    const es = new EventSource(`${SERVER_URL}/sse`);
    
    es.onopen = () => {
      console.log('SSE Connection opened');
    };
    
    es.onmessage = (event) => {
      console.log('SSE Message received:', event.data);
      
      // After receiving one message, test sending a message back
      testSendMessage();
    };
    
    es.onerror = (error) => {
      console.error('SSE Error:', error);
      es.close();
    };
    
    // Keep the connection open for a short time
    setTimeout(() => {
      console.log('Closing SSE connection after timeout');
      es.close();
    }, 10000);
    
  } catch (error) {
    console.error('Error testing connection:', error.message);
  }
}

async function testSendMessage() {
  try {
    console.log('\nTesting message endpoint...');
    const messageResponse = await fetch(`${SERVER_URL}/sse-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'listTools',
        params: {}
      })
    });
    
    const messageResult = await messageResponse.text();
    console.log('Message test:', messageResponse.status === 200 ? 'SUCCESS' : 'FAILED');
    console.log('Response:', messageResult);
  } catch (error) {
    console.error('Error testing message endpoint:', error.message);
  }
}

testConnection();