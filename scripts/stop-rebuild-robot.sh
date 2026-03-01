#!/bin/bash
#
# 🤖 Stop Rebuild Robot
#

PID_FILE="/tmp/rebuild-robot.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "🤖 Rebuild Robot is not running (no PID file)"
    exit 0
fi

PID=$(cat "$PID_FILE")

if ps -p "$PID" > /dev/null 2>&1; then
    echo "🛑 Stopping Rebuild Robot (PID: $PID)..."
    kill "$PID"
    sleep 2

    if ps -p "$PID" > /dev/null 2>&1; then
        echo "Force killing..."
        kill -9 "$PID"
    fi

    rm -f "$PID_FILE"
    echo "✅ Rebuild Robot stopped"
else
    echo "🤖 Rebuild Robot was not running"
    rm -f "$PID_FILE"
fi
