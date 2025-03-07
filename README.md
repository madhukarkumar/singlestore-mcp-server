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
