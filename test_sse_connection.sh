#\!/bin/bash

# Script to test SSE connection to the MCP server

# First, check if the server is running and get the actual port
echo "Checking server status..."
SERVER_INFO=$(curl -s http://localhost:8081 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "Couldn't connect to server on port 8081, trying port 8080..."
  SERVER_INFO=$(curl -s http://localhost:8080 2>/dev/null)
fi

if [ $? -ne 0 ]; then
  echo "Couldn't detect server port automatically, using default port 8081..."
  SERVER_PORT=8081
else
  SERVER_PORT=$(echo $SERVER_INFO | grep -o '"port":[0-9]*' | cut -d ':' -f2)
  if [ -z "$SERVER_PORT" ]; then
    echo "Couldn't extract port from server info, using default port 8081..."
    SERVER_PORT=8081
  else
    echo "Detected server running on port $SERVER_PORT"
  fi
fi

URL="http://localhost:$SERVER_PORT/sse"
echo "Testing SSE connection to $URL"
echo "---------------------------------"

# Check if server is running
echo "Step 1: Checking if server is accessible..."
curl -s -o /dev/null -w "%{http_code}" $URL | grep 200 > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Server is accessible"
else
    echo "❌ Server is not accessible. Make sure it's running with:"
    echo "   npm run start:inspector"
    exit 1
fi

# Test headers
echo
echo "Step 2: Checking response headers..."
CONTENT_TYPE=$(curl -s -I $URL | grep -i "Content-Type" | cut -d' ' -f2- | tr -d '\r\n')
if [[ "$CONTENT_TYPE" == *"text/event-stream"* ]]; then
    echo "✅ Content-Type is correctly set to: $CONTENT_TYPE"
else
    echo "❌ Content-Type is not set correctly: $CONTENT_TYPE"
    echo "   Expected: text/event-stream"
fi

# Test stream data
echo
echo "Step 3: Testing SSE data stream (will run for 5 seconds)..."
(timeout 5 curl -N $URL) | while read -r line; do
    if [ -n "$line" ]; then
        echo "  Received: $line"
    fi
done

echo
echo "Step 4: Testing MCP Inspector connection..."
echo "If MCP Inspector is still having trouble connecting:"
echo "1. Try using the URL: http://localhost:$SERVER_PORT/stream"
echo "2. Try using the URL: http://localhost:$SERVER_PORT"
echo "3. Check for any firewall blocking port $SERVER_PORT"
echo "4. Run 'netstat -an | grep $SERVER_PORT' to verify server is listening"
echo "5. Check server logs for detailed connection attempts"
echo

echo "Connection test complete"
