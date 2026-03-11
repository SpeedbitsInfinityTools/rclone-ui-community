#!/bin/bash

set -e

echo "=================================="
echo "Rclone Web UI Docker Container"
echo "=================================="
echo ""

# Set default values if not provided
RCLONE_USER=${RCLONE_USER:-admin}
RCLONE_PASS=${RCLONE_PASS:-admin}
RCLONE_PORT=${RCLONE_PORT:-5572}
FRONTEND_PORT=${FRONTEND_PORT:-3000}

echo "Starting rclone backend..."
echo "  Port: ${RCLONE_PORT}"
echo "  Username: ${RCLONE_USER}"
echo "  Config dir: /config/rclone"
echo ""

# Start rclone in the background
rclone rcd \
  --rc-user="${RCLONE_USER}" \
  --rc-pass="${RCLONE_PASS}" \
  --rc-addr="0.0.0.0:${RCLONE_PORT}" \
  --rc-allow-origin="*" \
  --config="/config/rclone/rclone.conf" \
  --rc-serve \
  --log-file=/var/log/rclone.log \
  --log-level=INFO &

RCLONE_PID=$!

# Wait for rclone to start
echo "Waiting for rclone backend to start..."
for i in {1..30}; do
  if curl -sf http://localhost:${RCLONE_PORT}/ >/dev/null 2>&1; then
    echo "✅ Rclone backend started successfully (PID: ${RCLONE_PID})"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Failed to start rclone backend"
    cat /var/log/rclone.log
    exit 1
  fi
  sleep 1
done

echo ""
echo "Starting nginx frontend..."
echo "  Port: ${FRONTEND_PORT}"
echo ""

# Start nginx in foreground
exec nginx -g "daemon off;"
