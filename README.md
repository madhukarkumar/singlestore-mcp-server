# SingleStore MCP Server

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

## Configuration

The server requires the following environment variables:

```env
SINGLESTORE_HOST=your-host.singlestore.com
SINGLESTORE_PORT=3306
SINGLESTORE_USER=your-username
SINGLESTORE_PASSWORD=your-password
SINGLESTORE_DATABASE=your-database
```

### Configuration Methods

1. **Environment Variables**:
   Set the variables in your shell:
   ```bash
   export SINGLESTORE_HOST=your-host.singlestore.com
   export SINGLESTORE_PORT=3306
   export SINGLESTORE_USER=your-username
   export SINGLESTORE_PASSWORD=your-password
   export SINGLESTORE_DATABASE=your-database
   ```

2. **MCP Settings Configuration**:
   Add to your MCP settings file (e.g., `cline_mcp_settings.json` or `claude_desktop_config.json`):
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
           "SINGLESTORE_DATABASE": "your-database"
         }
       }
     }
   }
   ```

## Usage

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

### Running Standalone

1. Build the server:
```bash
npm run build
```

2. Run the server:
```bash
node build/index.js
```

### Installing in Claude Desktop App

1. Add the server configuration to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "singlestore": {
      "command": "node",
      "args": ["path/to/mcp-server-singlestore/build/index.js"],
      "env": {
        "SINGLESTORE_HOST": "your-host.singlestore.com",
        "SINGLESTORE_PORT": "your-port",
        "SINGLESTORE_USER": "your-username",
        "SINGLESTORE_PASSWORD": "your-password",
        "SINGLESTORE_DATABASE": "your-database"
      }
    }
  }
}
```

2. Restart the Claude Desktop App

### Installing in Cursor

1. Add the server configuration to `~/Library/Application Support/Cursor/User/globalStorage/{user-name}.claude-dev/settings/cline_mcp_settings.json`:
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
        "SINGLESTORE_DATABASE": "your-database"
      }
    }
  }
}
```

2. Restart Cursor

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
   - Verify credentials and host information
   - Check SSL configuration
   - Ensure database is accessible from your network

2. **Build Issues**
   - Clear node_modules and reinstall dependencies
   - Verify TypeScript configuration
   - Check Node.js version compatibility

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details
