#!/bin/bash
#
# 🤖 Start Rebuild Robot für Unraid
#
# Dieses Script startet den Rebuild Robot im Hintergrund.
# Kann manuell oder via Unraid User Scripts ausgeführt werden.
#
# Installation für Unraid:
# 1. Kopiere dieses Script nach /boot/config/plugins/user.scripts/scripts/start-rebuild-robot/
# 2. Oder führe es manuell aus: ./start-rebuild-robot.sh
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROBOT_SCRIPT="${SCRIPT_DIR}/rebuild-robot.sh"
LOG_FILE="/mnt/user/appdata/claude-code-webui/data/rebuild-robot.log"
PID_FILE="/tmp/rebuild-robot.pid"

# Prüfe ob Robot-Script existiert
if [ ! -f "$ROBOT_SCRIPT" ]; then
    echo "ERROR: Robot script not found at $ROBOT_SCRIPT"
    exit 1
fi

# Prüfe ob bereits läuft
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "🤖 Rebuild Robot already running (PID: $OLD_PID)"
        exit 0
    else
        echo "Removing stale PID file..."
        rm -f "$PID_FILE"
    fi
fi

echo "🤖 Starting Rebuild Robot..."

# Starte Robot im Hintergrund
nohup "$ROBOT_SCRIPT" watch >> "$LOG_FILE" 2>&1 &
ROBOT_PID=$!

echo "$ROBOT_PID" > "$PID_FILE"

sleep 2

if ps -p "$ROBOT_PID" > /dev/null 2>&1; then
    echo "✅ Rebuild Robot started successfully (PID: $ROBOT_PID)"
    echo "   Log: $LOG_FILE"
    echo "   Stop: ./stop-rebuild-robot.sh"
else
    echo "❌ Failed to start Rebuild Robot"
    rm -f "$PID_FILE"
    exit 1
fi
