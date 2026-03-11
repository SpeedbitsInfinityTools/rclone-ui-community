#!/usr/bin/env bash
set -e

echo "=================================================="
echo "Starting Rclone Director UI (All-in-One)"
echo "=================================================="

# Runtime edition detection
# Check if Infinity Tools has injected the real servers.routes.js
INJECTED_ROUTES="/app/commercial/servers.routes.js"
TARGET_ROUTES="/app/backend/routes/servers.routes.js"

if [ -f "$INJECTED_ROUTES" ]; then
    echo "🔓 Commercial file detected - enabling multi-server support"
    cp "$INJECTED_ROUTES" "$TARGET_ROUTES"
    export EDITION="commercial"
    
    # Update .edition marker
    cat > /app/backend/.edition <<EOF
{
  "edition": "commercial",
  "features": ["multi-server", "add-server", "delete-server"],
  "max_servers": -1,
  "activated_at": "$(date -Iseconds)"
}
EOF
    echo "✓ Commercial edition activated"
else
    export EDITION="community"
    echo "📦 Running as Community Edition (single server)"
fi

echo "Edition: $EDITION"
echo "Version: ${VERSION:-unknown}"
echo ""

# Start Director backend in background
echo "[1/2] Starting Director backend on port 5573..."
cd /app/backend
node server.js > /logs/director.log 2>&1 &
DIRECTOR_PID=$!

# Check if process started
sleep 1
if ! kill -0 $DIRECTOR_PID 2>/dev/null; then
    echo "✗ Director failed to start - check /logs/director.log"
    cat /logs/director.log
    exit 1
fi

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in {1..30}; do
    if curl -sf http://localhost:5573/director/health > /dev/null 2>&1; then
        echo "✓ Backend is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "✗ Backend failed to start within 30 seconds"
        echo "✗ Check logs at /logs/director.log"
        cat /logs/director.log 2>/dev/null || true
        exit 1
    fi
    sleep 1
done

# Start nginx in foreground
echo "[2/2] Starting nginx on port 80..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Handle shutdown gracefully
trap "echo 'Shutting down...'; kill $DIRECTOR_PID $NGINX_PID 2>/dev/null; exit 0" SIGTERM SIGINT

echo "=================================================="
echo "✅ Rclone Director UI is running!"
echo "   Edition:  $EDITION"
echo "   Frontend: http://localhost:80"
echo "   Backend:  http://localhost:5573"
echo "=================================================="

# Wait for processes
wait
