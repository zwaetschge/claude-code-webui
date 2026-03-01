#!/bin/bash
#
# Repair Bot Entrypoint
# Syncs auth from main WebUI, runs rebuild watcher + WebUI.
#

set -e

echo "========================================"
echo "  Repair Bot - WebUI + Rebuild Watcher"
echo "========================================"

WATCHER_PID=""
WEBUI_PID=""

cleanup() {
    echo "[repair-bot] Shutting down..."
    if [ -n "$WATCHER_PID" ] && kill -0 "$WATCHER_PID" 2>/dev/null; then
        kill "$WATCHER_PID" 2>/dev/null
        wait "$WATCHER_PID" 2>/dev/null || true
    fi
    if [ -n "$WEBUI_PID" ] && kill -0 "$WEBUI_PID" 2>/dev/null; then
        kill "$WEBUI_PID" 2>/dev/null
        wait "$WEBUI_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGTERM SIGINT

# Sync auth credentials and sessions from main WebUI database
echo "[repair-bot] Syncing from main WebUI..."
cd /app && node /webui/scripts/sync-auth-from-main.mjs || echo "[repair-bot] Sync skipped"
cd /app

# Start rebuild-robot watcher in background
if [ -f "/webui/scripts/rebuild-robot-sidecar.sh" ]; then
    echo "[repair-bot] Starting rebuild watcher..."
    sh /webui/scripts/rebuild-robot-sidecar.sh &
    WATCHER_PID=$!
    echo "[repair-bot] Watcher started (PID: $WATCHER_PID)"
else
    echo "[repair-bot] WARNING: Sidecar script not found at /webui/scripts/rebuild-robot-sidecar.sh"
fi

# Start WebUI
echo "[repair-bot] Starting WebUI..."
npx tsx /app/packages/backend/src/index.ts &
WEBUI_PID=$!

wait "$WEBUI_PID"
