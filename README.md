# SingleStore MCP Server

[![smithery badge](https://smithery.ai/badge/@madhukarkumar/singlestore-mcp-server)](https://smithery.ai/server/@madhukarkumar/singlestore-mcp-server)

A Model Context Protocol (MCP) server for interacting with SingleStore databases. This server provides tools for querying tables, describing schemas, and generating ER diagrams.

## Features

- List all tables in the database
- Execute custom SQL queries
- Get detailed table information including schema and sample data
- Generate Mermaid ER diagrams of database schema
- SSL support with automatic CA bundle fetching
- Proper error handling and TypeScript type safety

## Prerequisites

- Node.js 16 or higher
- npm or yarn
- Access to a SingleStore database
- SingleStore CA bundle (automatically fetched from portal)

## Installation

### Installing via Smithery

To install SingleStore MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@madhukarkumar/singlestore-mcp-server):

```bash
npx -y @smithery/cli install @madhukarkumar/singlestore-mcp-server --client claude
```

1. Clone the repository:
```bash
git clone <repository-url>
cd mcp-server-singlestore
```

2. Install dependencies:
```bash
npm install
```

3. Build the server:
```bash
npm run build
```

## Environment Variables

### Required Environment Variables

The server requires the following environment variables for database connection:

```env
SINGLESTORE_HOST=your-host.singlestore.com
SINGLESTORE_PORT=3306
SINGLESTORE_USER=your-username
SINGLESTORE_PASSWORD=your-password
SINGLESTORE_DATABASE=your-database
```

All these environment variables are required for the server to establish a connection to your SingleStore database. The connection uses SSL with the SingleStore CA bundle, which is automatically fetched from the SingleStore portal.

### Optional Environment Variables

For SSE (Server-Sent Events) protocol support:

```env
SSE_ENABLED=true       # Enable the SSE HTTP server (default: false if not set)
SSE_PORT=3333          # HTTP port for the SSE server (default: 3333 if not set)
```

### Setting Environment Variables

1. **In Your Shell**:
   Set the variables in your terminal before running the server:
   ```bash
   export SINGLESTORE_HOST=your-host.singlestore.com
   export SINGLESTORE_PORT=3306
   export SINGLESTORE_USER=your-username
   export SINGLESTORE_PASSWORD=your-password
   export SINGLESTORE_DATABASE=your-database
   ```

2. **In Client Configuration Files**:
   Add the variables to your MCP client configuration file as shown in the integration sections below.

## Usage

### Protocol Support

This server supports two protocols for client integration:

1. **MCP Protocol**: The standard Model Context Protocol using stdio communication, used by Claude Desktop, Windsurf, and Cursor.
2. **SSE Protocol**: Server-Sent Events over HTTP for web-based clients and applications that need real-time data streaming.

Both protocols expose the same tools and functionality, allowing you to choose the best integration method for your use case.

### Available Tools

1. **list_tables**
   - Lists all tables in the database
   - No parameters required
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "list_tables",
     arguments: {}
   })
   ```

2. **query_table**
   - Executes a custom SQL query
   - Parameters:
     - query: SQL query string
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "query_table",
     arguments: {
       query: "SELECT * FROM your_table LIMIT 5"
     }
   })
   ```

3. **describe_table**
   - Gets detailed information about a table
   - Parameters:
     - table: Table name
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "describe_table",
     arguments: {
       table: "your_table"
     }
   })
   ```

4. **generate_er_diagram**
   - Generates a Mermaid ER diagram of the database schema
   - No parameters required
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "generate_er_diagram",
     arguments: {}
   })
   ```

5. **run_read_query**
   - Executes a read-only (SELECT) query on the database
   - Parameters:
     - query: SQL SELECT query to execute
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "run_read_query",
     arguments: {
       query: "SELECT * FROM your_table LIMIT 5"
     }
   })
   ```

6. **create_table**
   - Create a new table in the database with specified columns and constraints
   - Parameters:
     - table_name: Name of the table to create
     - columns: Array of column definitions
     - table_options: Optional table configuration
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "create_table",
     arguments: {
       table_name: "new_table",
       columns: [
         {
           name: "id",
           type: "INT",
           nullable: false,
           auto_increment: true
         },
         {
           name: "name",
           type: "VARCHAR(255)",
           nullable: false
         }
       ],
       table_options: {
         shard_key: ["id"],
         sort_key: ["name"]
       }
     }
   })
   ```

7. **generate_synthetic_data**
   - Generate and insert synthetic data into an existing table
   - Parameters:
     - table: Name of the table to insert data into
     - count: Number of rows to generate (default: 100)
     - column_generators: Custom generators for specific columns
     - batch_size: Number of rows to insert in each batch (default: 1000)
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "generate_synthetic_data",
     arguments: {
       table: "customers",
       count: 1000,
       column_generators: {
         "customer_id": {
           "type": "sequence",
           "start": 1000
         },
         "status": {
           "type": "values",
           "values": ["active", "inactive", "pending"]
         },
         "signup_date": {
           "type": "formula",
           "formula": "NOW() - INTERVAL FLOOR(RAND() * 365) DAY"
         }
       },
       batch_size: 500
     }
   })
   ```

8. **optimize_sql**
   - Analyze a SQL query using PROFILE and provide optimization recommendations
   - Parameters:
     - query: SQL query to analyze and optimize
   ```typescript
   use_mcp_tool({
     server_name: "singlestore",
     tool_name: "optimize_sql",
     arguments: {
       query: "SELECT * FROM customers JOIN orders ON customers.id = orders.customer_id WHERE region = 'west'"
     }
   })
   ```
   - The response includes:
     - Original query
     - Performance profile summary (total runtime, compile time, execution time)
     - List of detected bottlenecks
     - Optimization recommendations with impact levels (high/medium/low)
     - Suggestions for indexes, joins, memory usage, and other optimizations

### Running Standalone

1. Build the server:
```bash
npm run build
```

2. Run the server with MCP protocol only:
```bash
node build/index.js
```

3. Run the server with both MCP and SSE protocols:
```bash
SSE_ENABLED=true SSE_PORT=3333 node build/index.js
```

### Using the SSE Protocol

When SSE is enabled, the server exposes the following HTTP endpoints:

1. **Root Endpoint**
   ```
   GET /
   ```
   Returns server information and available endpoints.

2. **Health Check**
   ```
   GET /health
   ```
   Returns status information about the server.

3. **SSE Connection**
   ```
   GET /sse
   ```
   Establishes a Server-Sent Events connection for real-time updates.

4. **List Tools**
   ```
   GET /tools
   ```
   Returns a list of all available tools, same as the MCP `list_tools` functionality.

   Also supports POST requests for MCP Inspector compatibility:
   ```
   POST /tools
   Content-Type: application/json
   
   {
     "jsonrpc": "2.0",
     "id": "request-id",
     "method": "mcp.list_tools",
     "params": {}
   }
   ```

5. **Call Tool**
   ```
   POST /call-tool
   Content-Type: application/json
   
   {
     "name": "tool_name",
     "arguments": {
       "param1": "value1",
       "param2": "value2"
     },
     "client_id": "optional_sse_client_id_for_streaming_response"
   }
   ```
   Executes a tool with the provided arguments.
   
   - If `client_id` is provided, the response is streamed to that SSE client.
   - If `client_id` is omitted, the response is returned directly in the HTTP response.
   
   Also supports standard MCP format for MCP Inspector compatibility:
   ```
   POST /call-tool
   Content-Type: application/json
   
   {
     "jsonrpc": "2.0",
     "id": "request-id",
     "method": "mcp.call_tool",
     "params": {
       "name": "tool_name",
       "arguments": {
         "param1": "value1",
         "param2": "value2"
       },
       "_meta": {
         "client_id": "optional_sse_client_id_for_streaming_response"
       }
     }
   }
   ```

#### SSE Event Types

When using SSE connections, the server sends the following event types:

1. **message** (unnamed event): Sent when an SSE connection is successfully established.
2. **open**: Additional connection established event.
3. **message**: Used for all MCP protocol messages including tool start, result, and error events.

All events follow the JSON-RPC 2.0 format used by the MCP protocol. The system uses the standard `message` event type for compatibility with the MCP Inspector and most SSE client libraries.

#### Example JavaScript Client

```javascript
// Connect to SSE endpoint
const eventSource = new EventSource('http://localhost:3333/sse');
let clientId = null;

// Handle connection establishment via unnamed event
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'connection_established') {
    clientId = data.clientId;
    console.log(`Connected with client ID: ${clientId}`);
  }
};

// Handle open event
eventSource.addEventListener('open', (event) => {
  console.log('SSE connection opened via open event');
});

// Handle all MCP messages
eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.jsonrpc === '2.0') {
    if (data.result) {
      console.log('Tool result:', data.result);
    } else if (data.error) {
      console.error('Tool error:', data.error);
    } else if (data.method === 'mcp.call_tool.update') {
      console.log('Tool update:', data.params);
    }
  }
});

// Call a tool with streaming response (custom format)
async function callTool(name, args) {
  const response = await fetch('http://localhost:3333/call-tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name,
      arguments: args,
      client_id: clientId
    })
  });
  return response.json();
}

// Call a tool with streaming response (MCP format)
async function callToolMcp(name, args) {
  const response = await fetch('http://localhost:3333/call-tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'request-' + Date.now(),
      method: 'mcp.call_tool',
      params: {
        name: name,
        arguments: args,
        _meta: {
          client_id: clientId
        }
      }
    })
  });
  return response.json();
}

// Example usage
callTool('list_tables', {})
  .then(response => console.log('Request accepted:', response));
```

### Using with MCP Inspector

The MCP Inspector is a browser-based tool for testing and debugging MCP servers. To use it with this server:

1. Start both the server and MCP inspector in one command:
   ```bash
   npm run inspector
   ```
   
   Or start just the server with:
   ```bash
   npm run start:inspector
   ```

2. To install and run the MCP Inspector separately:
   ```bash
   npx @modelcontextprotocol/inspector
   ```
   
   The inspector will open in your default browser.

3. When the MCP Inspector opens:
   
   a. Enter the URL in the connection field:
      ```
      http://localhost:8081
      ```
      
      Note: The actual port may vary depending on your configuration. Check the server 
      startup logs for the actual port being used. The server will output:
      ```
      MCP SingleStore SSE server listening on port XXXX
      ```
      
   b. Make sure "SSE" is selected as the transport type
   
   c. Click "Connect"

4. If you encounter connection issues, try these alternatives:
   
   a. Try connecting to a specific endpoint:
      ```
      http://localhost:8081/stream
      ```
      
   b. Try using your machine's actual IP address:
      ```
      http://192.168.1.x:8081
      ```
      
   c. If running in Docker:
      ```
      http://host.docker.internal:8081
      ```

5. **Debugging connection issues**:
   
   a. Verify the server is running by visiting http://localhost:8081 in your browser
   
   b. Check the server logs for connection attempts
   
   c. Try restarting both the server and inspector
   
   d. Make sure no other service is using port 8081
   
   e. Test SSE connection with the provided script:
      ```bash
      npm run test:sse
      ```
      
      Or manually with curl:
      ```bash
      curl -N http://localhost:8081/sse
      ```
      
   f. Verify your firewall settings allow connections to port 8081

6. Once connected, the inspector will show all available tools and allow you to test them interactively.

⚠️ **Note**: When using the MCP Inspector, you must use the full URL, including the `http://` prefix.

## MCP Client Integration

### Installing in Claude Desktop

1. Add the server configuration to your Claude Desktop config file located at:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "singlestore": {
      "command": "node",
      "args": ["path/to/mcp-server-singlestore/build/index.js"],
      "env": {
        "SINGLESTORE_HOST": "your-host.singlestore.com",
        "SINGLESTORE_PORT": "3306",
        "SINGLESTORE_USER": "your-username",
        "SINGLESTORE_PASSWORD": "your-password",
        "SINGLESTORE_DATABASE": "your-database",
        "SSE_ENABLED": "true",
        "SSE_PORT": "3333"
      }
    }
  }
}
```

The SSE_ENABLED and SSE_PORT variables are optional. Include them if you want to enable the HTTP server with SSE support alongside the standard MCP protocol.

2. Restart the Claude Desktop App

3. In your conversation with Claude, you can now use the SingleStore MCP server with:
```
use_mcp_tool({
  server_name: "singlestore",
  tool_name: "list_tables",
  arguments: {}
})
```

### Installing in Windsurf 

1. Add the server configuration to your Windsurf config file located at:
   - macOS: `~/Library/Application Support/Windsurf/config.json`
   - Windows: `%APPDATA%\Windsurf\config.json`

```json
{
  "mcpServers": {
    "singlestore": {
      "command": "node",
      "args": ["path/to/mcp-server-singlestore/build/index.js"],
      "env": {
        "SINGLESTORE_HOST": "your-host.singlestore.com",
        "SINGLESTORE_PORT": "3306",
        "SINGLESTORE_USER": "your-username",
        "SINGLESTORE_PASSWORD": "your-password",
        "SINGLESTORE_DATABASE": "your-database",
        "SSE_ENABLED": "true",
        "SSE_PORT": "3333"
      }
    }
  }
}
```

The SSE_ENABLED and SSE_PORT variables are optional, but enable additional functionality through the SSE HTTP server.

2. Restart Windsurf

3. In your conversation with Claude in Windsurf, the SingleStore MCP tools will be available automatically when Claude needs to access database information.

### Installing in Cursor

1. Add the server configuration to your Cursor settings:
   - Open Cursor
   - Go to Settings (gear icon) > Extensions > Claude AI > MCP Servers
   - Add a new MCP server with the following configuration:

```json
{
  "singlestore": {
    "command": "node",
    "args": ["path/to/mcp-server-singlestore/build/index.js"],
    "env": {
      "SINGLESTORE_HOST": "your-host.singlestore.com",
      "SINGLESTORE_PORT": "3306",
      "SINGLESTORE_USER": "your-username",
      "SINGLESTORE_PASSWORD": "your-password",
      "SINGLESTORE_DATABASE": "your-database",
      "SSE_ENABLED": "true",
      "SSE_PORT": "3333"
    }
  }
}
```

The SSE_ENABLED and SSE_PORT variables allow web applications to connect to the server via HTTP and receive real-time updates through Server-Sent Events.

2. Restart Cursor

3. When using Claude AI within Cursor, the SingleStore MCP tools will be available for database operations.


## Security Considerations

1. Never commit credentials to version control
2. Use environment variables or secure configuration management
3. Consider using a connection pooling mechanism for production use
4. Implement appropriate access controls and user permissions in SingleStore
5. Keep the SingleStore CA bundle up to date

## Development

### Project Structure

```
mcp-server-singlestore/
├── src/
│   └── index.ts      # Main server implementation
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## Troubleshooting

1. **Connection Issues**
   - Verify credentials and host information in your environment variables
   - Check SSL configuration
   - Ensure database is accessible from your network
   - Check your firewall settings to allow outbound connections to your SingleStore database

2. **Build Issues**
   - Clear node_modules and reinstall dependencies
   - Verify TypeScript configuration
   - Check Node.js version compatibility (should be 16+)

3. **MCP Integration Issues**
   - Verify the path to the server's build/index.js file is correct in your client configuration
   - Check that all environment variables are properly set in your client configuration
   - Restart your client application after making configuration changes
   - Check client logs for any error messages related to the MCP server
   - Try running the server standalone first to validate it works outside the client

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details
