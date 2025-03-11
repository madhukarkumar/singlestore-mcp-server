#\!/bin/bash

# Script to debug headers returned by the SSE server endpoints

PORT=8081
echo "Testing headers on port $PORT"
echo "=========================================="

# Check root endpoint
echo "Testing root endpoint (GET /):"
curl -s -I http://localhost:$PORT | grep -i content-type
echo

# Check SSE endpoint
echo "Testing SSE endpoint (GET /sse):"
curl -s -I http://localhost:$PORT/sse | grep -i content-type
echo

# Check stream endpoint
echo "Testing stream endpoint (GET /stream):"
curl -s -I http://localhost:$PORT/stream | grep -i content-type
echo

# Check mcp-sse endpoint
echo "Testing mcp-sse endpoint (GET /mcp-sse):"
curl -s -I http://localhost:$PORT/mcp-sse | grep -i content-type
echo

# Check connect endpoint
echo "Testing connect endpoint (GET /connect?transportType=sse):"
curl -s -I "http://localhost:$PORT/connect?transportType=sse" | grep -i content-type
curl -s -I "http://localhost:$PORT/connect?transportType=sse" | grep -i location
echo

# Try to simulate MCP Inspector
echo "Testing with MCP Inspector headers:"
curl -s -I \
  -H "Accept: text/event-stream" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: node" \
  http://localhost:$PORT/stream | grep -i content-type
echo

# Check using verbose mode to see all headers
echo "Verbose headers check for /mcp-sse endpoint:"
curl -s -v http://localhost:$PORT/mcp-sse 2>&1 | grep -i "< " | head -10
echo

echo "Debug complete"
