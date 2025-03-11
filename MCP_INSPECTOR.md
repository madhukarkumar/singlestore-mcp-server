# Connecting MCP Inspector to SingleStore MCP Server

This document provides detailed instructions for connecting the MCP Inspector to the SingleStore MCP Server.

## Starting the Server

1. Start the server with:
   ```bash
   npm run start:inspector
   ```

2. Look for the following lines in the server output:
   ```
   MCP SingleStore SSE server listening on port 8081
   MCP Inspector compatible endpoints:
     - http://localhost:8081/stream
     - http://localhost:8081/mcp-sse
   ```

## Connecting MCP Inspector

There are several ways to start the MCP Inspector:

### Option 1: Using the Combined Script

Run:
```bash
npm run inspector
```

This script will start both the server and the MCP Inspector.

### Option 2: Starting the Inspector Separately

If the server is already running:
```bash
npx @modelcontextprotocol/inspector
```

### Connection Options

When the MCP Inspector opens, try one of the following URLs in order of recommendation:

1. Standard MCP Inspector connection endpoint:
   ```
   http://localhost:8081/connect?transportType=sse
   ```

2. Primary SSE Stream endpoint:
   ```
   http://localhost:8081/stream
   ```

3. Alternative SSE endpoint:
   ```
   http://localhost:8081/mcp-sse
   ```

4. Root server URL:
   ```
   http://localhost:8081
   ```

Make sure "SSE" is selected as the transport type in the dropdown.

## Troubleshooting

If you encounter connection issues:

1. **Debug Headers**:
   ```bash
   npm run debug:headers
   ```
   This will check the Content-Type headers returned by different endpoints.

2. **Test SSE Connection**:
   ```bash
   npm run test:sse
   ```
   This will test if the SSE connection is working properly.

3. **Check Server Logs**:
   Look for messages like:
   - `[SSE] Connection attempt from 127.0.0.1 with transport sse`
   - `[SSE] Set Content-Type header: text/event-stream`

4. **Common Issues**:
   - If you see `Invalid content type, expected "text/event-stream"`, try using the `/stream` or `/mcp-sse` endpoints
   - If you see connection timeouts, ensure the server is running and the port is correct
   - Try restarting both the server and the MCP Inspector

5. **Manual Testing**:
   You can try a direct curl request:
   ```bash
   curl -N http://localhost:8081/stream
   ```
   You should see events streaming in.

## Endpoint Reference

| Endpoint | Purpose |
|----------|---------|
| `/` | Root endpoint - server information |
| `/connect?transportType=sse` | Standard MCP Inspector connection endpoint (recommended) |
| `/stream` | Primary SSE endpoint for MCP Inspector |
| `/mcp-sse` | Alternative SSE endpoint with different header setting |
| `/sse` | Standard SSE endpoint |
| `/health` | Health check endpoint |
| `/tools` | List available tools |
| `/call-tool` | Execute a tool (POST) |

## Common Connection URLs

Below are the complete connection URLs to try in the MCP Inspector, in order of most likely to work:

1. `http://localhost:8081/connect?transportType=sse`
2. `http://localhost:8081/stream`
3. `http://localhost:8081/mcp-sse`
4. `http://localhost:8081`
