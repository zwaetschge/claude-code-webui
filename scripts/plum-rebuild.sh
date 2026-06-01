#!/usr/bin/env bash
# plum-rebuild.sh — atomic rebuild + redeploy via the rebuild-robot sidecar.
#
# Why this script exists:
#   Running `docker compose build` followed by `up -d --force-recreate` from
#   INSIDE the WebUI container kills the very process making the call. The
#   container ends up in "Created" state on the old image, and a human has to
#   `docker start` it manually. This happened multiple times before this script
#   existed.
#
# How it works now:
#   The compose stack ships a `repair-bot` sidecar (a sibling container that
#   shares the project mount at /webui). It polls /webui/data/rebuild-trigger.json
#   every 5s; when the file appears it runs build → stop → up from OUTSIDE the
#   main container, so the rebuild can't terminate its own caller.
#
#   This script just writes the trigger file and tails the status file until
#   the robot reports completion (or failure / timeout). Zero docker commands
#   in this script's process — the sidecar owns the whole atomic operation.
#
# Flags:
#   --no-cache    Force `docker compose build --no-cache`
#   --no-wait     Submit the trigger and return immediately (don't tail status)
#   --timeout N   Max seconds to wait for completion (default 600)
#
# Exit codes:
#   0 = rebuild reported success
#   1 = rebuild reported failure or status file unreadable
#   2 = timeout waiting for status transition
#   3 = repair-bot sidecar not running (manual recovery needed)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TRIGGER_FILE="${PROJECT_DIR}/data/rebuild-trigger.json"
STATUS_FILE="${PROJECT_DIR}/data/rebuild-robot-status.json"
LOG_FILE="${PROJECT_DIR}/data/rebuild-robot.log"
SIDECAR_NAME="repair-bot"

NO_CACHE="false"
NO_WAIT=0
TIMEOUT=600
REASON="plum-rebuild via $(whoami)@$(hostname 2>/dev/null || echo unknown)"

for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE="true" ;;
    --no-wait)  NO_WAIT=1 ;;
    --timeout=*) TIMEOUT="${arg#--timeout=}" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

# Sanity: is the sidecar even running? If not, the trigger file would sit
# forever and we'd timeout. Fail fast with a clear message instead.
if ! docker ps --filter "name=^${SIDECAR_NAME}$" --format '{{.Names}}' | grep -q "^${SIDECAR_NAME}$"; then
  echo "✗ ${SIDECAR_NAME} sidecar is not running" >&2
  echo "  Start it manually: docker compose up -d ${SIDECAR_NAME}" >&2
  echo "  (you're hitting the failure mode this script was created to prevent)" >&2
  exit 3
fi

ISO_TS="$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"

echo "==> Writing rebuild trigger: $TRIGGER_FILE"
cat > "$TRIGGER_FILE" <<EOF
{
  "reason": "${REASON}",
  "timestamp": "${ISO_TS}",
  "noCache": ${NO_CACHE}
}
EOF

if [ "$NO_WAIT" -eq 1 ]; then
  echo "✓ trigger submitted (not waiting for completion)"
  echo "  Tail status: cat ${STATUS_FILE}"
  echo "  Tail log:    tail -f ${LOG_FILE}"
  exit 0
fi

# Poll status file until we see a terminal state. The robot writes:
#   building / stopping / starting → working
#   ready / watching / idle         → finished (success after a build)
#   error                           → finished (failure)
#
# We mark "build started" the first time we see a non-idle phase, then watch
# for return to idle (success) or transition to error.
echo "==> Waiting for repair-bot (timeout ${TIMEOUT}s)"
start=$(date +%s)
saw_active=0
last_status=""
last_phase=""

while true; do
  now=$(date +%s)
  if [ $((now - start)) -gt "$TIMEOUT" ]; then
    echo "✗ timeout after ${TIMEOUT}s (last: ${last_status} / ${last_phase})" >&2
    echo "  Robot log tail:" >&2
    tail -20 "$LOG_FILE" 2>&1 | sed 's/^/    /' >&2
    exit 2
  fi

  if [ -r "$STATUS_FILE" ]; then
    status=$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATUS_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
    phase=$(grep -o '"phase"[[:space:]]*:[[:space:]]*"[^"]*"' "$STATUS_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

    if [ "$status" != "$last_status" ] || [ "$phase" != "$last_phase" ]; then
      printf '    [%s] status=%s phase=%s\n' "$(date '+%H:%M:%S')" "${status:-?}" "${phase:-?}"
      last_status="$status"
      last_phase="$phase"
    fi

    case "$status" in
      building|stopping|starting)
        saw_active=1
        ;;
      error)
        echo "✗ rebuild reported error" >&2
        tail -30 "$LOG_FILE" 2>&1 | sed 's/^/    /' >&2
        exit 1
        ;;
      watching|ready|idle)
        if [ "$saw_active" -eq 1 ]; then
          echo "✓ rebuild complete"
          # Quick external health probe — only as a sanity check; the robot's
          # own health gate already passed by this point.
          WEBUI_PORT="${WEBUI_PORT:-4545}"
          if curl -sf -m 5 "http://localhost:${WEBUI_PORT}/" > /dev/null 2>&1; then
            echo "✓ external health OK on port ${WEBUI_PORT}"
          else
            echo "! external health check failed; container may still be warming up"
          fi
          exit 0
        fi
        ;;
    esac
  fi

  sleep 2
done
