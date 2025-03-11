#\!/bin/bash

# Script to start both the SingleStore MCP server and the MCP inspector

# Build the server
echo "Building MCP server..."
npm run build

# Start the SingleStore MCP server with SSE enabled
echo "Starting SingleStore MCP server on port 8081..."
SSE_ENABLED=true MCP_SSE_PORT=8081 node build/index.js &
SERVER_PID=$\!

# Give the server a moment to start
sleep 2

# Check if the server is running and get the actual port
SERVER_INFO=$(curl -s http://localhost:8081 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "Checking for alternate port..."
  SERVER_INFO=$(curl -s http://localhost:8082 2>/dev/null)
  SERVER_PORT=8082
else
  SERVER_PORT=8081
fi

echo "Server detected on port $SERVER_PORT"
echo "Server status: $(curl -s http://localhost:$SERVER_PORT/health)"

# Start the MCP Inspector
echo "Starting MCP Inspector..."
echo "When the Inspector opens, connect to: http://localhost:$SERVER_PORT"
npx -y @modelcontextprotocol/inspector

# When the user exits the MCP Inspector, also kill the server
kill $SERVER_PID
echo "Stopped MCP server."
