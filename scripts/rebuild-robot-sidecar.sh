#!/bin/sh
#
# Rebuild Robot Sidecar - runs as a Docker Compose sidecar container
# Watches for rebuild triggers and rebuilds the main container from outside.
#
# This script is POSIX sh compatible (no bash required).
#

set -e

WEBUI_DIR="/webui"
COMPOSE_FILE="${WEBUI_DIR}/docker-compose.yml"
TRIGGER_FILE="${WEBUI_DIR}/data/rebuild-trigger.json"
STATUS_FILE="${WEBUI_DIR}/data/rebuild-robot-status.json"
REPORT_FILE="${WEBUI_DIR}/REBUILD_ROBOT_REPORT.md"
LOG_FILE="${WEBUI_DIR}/data/rebuild-robot.log"
LOCK_FILE="/tmp/rebuild-robot.lock"

MAIN_SERVICE="claude-code-webui"
# Project name must match the original compose project (derived from the host directory name).
# Inside the repair-bot container, the compose file is at /webui/ which would derive project "webui",
# but the actual containers run under project "claude-code-webui".
COMPOSE_PROJECT="claude-code-webui"
POLL_INTERVAL=5
HEARTBEAT_INTERVAL=10
ROBOT_VERSION="2.1-sidecar"

# Timestamp helper
timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

iso_timestamp() {
  date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z'
}

log() {
  printf '%s [%s] %s\n' "$(timestamp)" "$1" "$2" | tee -a "$LOG_FILE"
}

log_info()    { log "INFO"    "$1"; }
log_warn()    { log "WARN"    "$1"; }
log_error()   { log "ERROR"   "$1"; }
log_success() { log "SUCCESS" "$1"; }

# Write JSON status file (also serves as heartbeat)
write_status() {
  _status="$1"
  _message="$2"
  _phase="$3"
  cat > "$STATUS_FILE" << EOF
{
  "status": "${_status}",
  "message": "${_message}",
  "phase": "${_phase}",
  "timestamp": "$(iso_timestamp)",
  "robot_version": "${ROBOT_VERSION}",
  "container": true
}
EOF
}

# Write markdown report
write_report() {
  _status="$1"
  _start="$2"
  _end="$3"
  _build_output="$4"
  _error="$5"

  _duration=$(( _end - _start ))

  if [ "$_status" = "success" ]; then
    _emoji="✅"
    _text="ERFOLGREICH"
  else
    _emoji="❌"
    _text="FEHLGESCHLAGEN"
  fi

  cat > "$REPORT_FILE" << EOF
# Rebuild Robot Report

## Status: ${_emoji} ${_text}

| Feld | Wert |
|------|------|
| Gestartet | $(date -d "@${_start}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "${_start}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "${_start}") |
| Beendet | $(date -d "@${_end}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "${_end}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "${_end}") |
| Dauer | ${_duration} Sekunden |
| Robot Version | ${ROBOT_VERSION} |
| Modus | Docker Compose Sidecar |

## Phasen

### Phase 1: Build
\`\`\`
docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} build ${MAIN_SERVICE}
\`\`\`

### Phase 2: Container Stop
\`\`\`
docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} stop ${MAIN_SERVICE}
\`\`\`

### Phase 3: Container Start
\`\`\`
docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} up -d ${MAIN_SERVICE}
\`\`\`

EOF

  if [ -n "$_error" ]; then
    cat >> "$REPORT_FILE" << EOF
## Fehler

\`\`\`
${_error}
\`\`\`

EOF
  fi

  # Trim build output to last 50 lines
  _trimmed_output=$(echo "$_build_output" | tail -50)
  cat >> "$REPORT_FILE" << EOF
## Build Output (letzte 50 Zeilen)

\`\`\`
${_trimmed_output}
\`\`\`

---
*Report generiert von Rebuild Robot Sidecar v${ROBOT_VERSION}*
EOF
}

# Execute rebuild - targets ONLY the main service
do_rebuild() {
  _no_cache="${1:-false}"
  _start_time=$(date +%s)
  _build_output=""
  _error_message=""

  log_info "Rebuild Robot startet..."
  write_status "building" "Docker Image wird gebaut..." "build"

  # Phase 1: Build (only main service)
  log_info "Phase 1: Building Docker image for ${MAIN_SERVICE}..."

  _build_cmd="docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} build ${MAIN_SERVICE}"
  if [ "$_no_cache" = "true" ]; then
    _build_cmd="docker compose -f ${COMPOSE_FILE} -p ${COMPOSE_PROJECT} build --no-cache ${MAIN_SERVICE}"
  fi

  if _build_output=$($_build_cmd 2>&1); then
    log_success "Build erfolgreich!"
  else
    log_error "Build fehlgeschlagen!"
    _error_message="Build failed: $_build_output"
    write_status "error" "$_error_message" "build"
    write_report "error" "$_start_time" "$(date +%s)" "$_build_output" "$_error_message"
    return 1
  fi

  # Phase 2: Handover + Stop main container
  log_info "Phase 2: Handover und Stop ${MAIN_SERVICE}..."
  write_status "stopping" "Handover wird vorbereitet..." "handover"

  # 2a: Prepare shutdown via API (notify clients, get active session count)
  _active_sessions=0
  _handover_response=""
  if _handover_response=$(wget -qO- --post-data='{"reason":"rebuild"}' \
       --header="Content-Type: application/json" \
       "http://${MAIN_SERVICE}:3001/api/handover/prepare-shutdown" 2>&1); then
    _active_sessions=$(echo "$_handover_response" | grep -o '"activeSessions":[0-9]*' | grep -o '[0-9]*' || echo "0")
    log_info "Handover bestätigt. Aktive Sessions: ${_active_sessions}"
  else
    log_warn "Handover-API nicht erreichbar (Container evtl. schon gestoppt). Fahre fort..."
  fi

  # 2b: Write handover file for main container to read on restart
  cat > "${WEBUI_DIR}/data/container-handover.json" << HEOF
{
  "from": "repair-bot",
  "to": "${MAIN_SERVICE}",
  "reason": "rebuild",
  "activeSessions": ${_active_sessions},
  "timestamp": "$(iso_timestamp)",
  "message": "Rebuild durch Repair-Bot. ${_active_sessions} aktive Session(s) unterbrochen."
}
HEOF
  log_info "Handover-File geschrieben"

  # 2c: Give clients time to see the shutdown warning
  sleep 3

  # 2d: Stop the container
  write_status "stopping" "Container wird gestoppt..." "stop"
  if docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" stop "$MAIN_SERVICE" 2>&1; then
    log_success "Container gestoppt!"
  else
    log_warn "Container stoppen hatte Probleme, versuche fortzufahren..."
  fi

  # Remove stopped container to avoid name conflicts on recreate
  log_info "Phase 2b: Removing stopped container..."
  docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" rm -f "$MAIN_SERVICE" 2>&1 || true

  sleep 2

  # Phase 3: Start main container with new image
  log_info "Phase 3: Starting ${MAIN_SERVICE} with new image..."
  write_status "starting" "Neuer Container wird gestartet..." "start"

  if docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" up -d --no-deps "$MAIN_SERVICE" 2>&1; then
    log_success "Container gestartet!"
  else
    log_error "Container Start fehlgeschlagen!"
    _error_message="Container start failed"
    write_status "error" "$_error_message" "start"
    write_report "error" "$_start_time" "$(date +%s)" "$_build_output" "$_error_message"
    return 1
  fi

  # Wait for container startup and health check
  log_info "Warte auf Container-Startup und Health-Check..."
  _health_ok=false
  _health_attempts=0
  _health_max=12
  while [ "$_health_attempts" -lt "$_health_max" ]; do
    sleep 5
    _health_attempts=$(( _health_attempts + 1 ))
    if wget -qO- "http://${MAIN_SERVICE}:3001/health" >/dev/null 2>&1; then
      _health_ok=true
      break
    fi
    log_info "Health-Check Versuch ${_health_attempts}/${_health_max}..."
  done

  # Verify
  if [ "$_health_ok" = "true" ] && docker ps --format '{{.Names}}' | grep -q "$MAIN_SERVICE"; then
    log_success "Rebuild erfolgreich abgeschlossen! Health-Check OK nach ${_health_attempts} Versuch(en)."
    write_status "success" "Rebuild erfolgreich abgeschlossen" "complete"
    write_report "success" "$_start_time" "$(date +%s)" "$_build_output" ""

    # Remove trigger file
    rm -f "$TRIGGER_FILE"
    return 0
  else
    log_error "Container läuft nicht nach Rebuild!"
    _error_message="Container is not running after rebuild"
    write_status "error" "$_error_message" "verify"
    write_report "error" "$_start_time" "$(date +%s)" "$_build_output" "$_error_message"
    return 1
  fi
}

# Background heartbeat - keeps status file fresh so WebUI detects us
start_heartbeat() {
  while true; do
    # Only write heartbeat if we're in watching state (not during rebuild)
    if [ ! -f "$LOCK_FILE" ]; then
      write_status "watching" "Warte auf Rebuild-Request..." "idle"
    fi
    sleep "$HEARTBEAT_INTERVAL"
  done &
  HEARTBEAT_PID=$!
}

# Main watch loop
watch() {
  log_info "========================================="
  log_info "  Rebuild Robot Sidecar v${ROBOT_VERSION}"
  log_info "  Watching: ${TRIGGER_FILE}"
  log_info "  Target:   ${MAIN_SERVICE}"
  log_info "  Poll:     ${POLL_INTERVAL}s"
  log_info "========================================="

  # Ensure data directory exists
  mkdir -p "${WEBUI_DIR}/data"

  # Start heartbeat
  start_heartbeat
  log_info "Heartbeat gestartet (PID: ${HEARTBEAT_PID})"

  # Initial status
  write_status "watching" "Warte auf Rebuild-Request..." "idle"

  # Trap for cleanup
  trap 'log_info "Shutting down..."; kill $HEARTBEAT_PID 2>/dev/null; exit 0' INT TERM

  while true; do
    if [ -f "$TRIGGER_FILE" ]; then
      log_info "Trigger-File erkannt!"

      # Check for noCache option
      _no_cache="false"
      if grep -q '"noCache".*true' "$TRIGGER_FILE" 2>/dev/null; then
        _no_cache="true"
        log_info "noCache option erkannt"
      fi

      # Set lock
      if [ -f "$LOCK_FILE" ]; then
        log_warn "Rebuild bereits in Progress, überspringe..."
        sleep "$POLL_INTERVAL"
        continue
      fi
      touch "$LOCK_FILE"

      # Execute rebuild
      if do_rebuild "$_no_cache"; then
        log_success "Rebuild erfolgreich!"
        # Keep success status for 30s so container can read it on startup
        log_info "Warte 30s damit Container den Status lesen kann..."
        sleep 30
      else
        log_error "Rebuild fehlgeschlagen!"
        # Remove trigger file on failure to prevent infinite retry loop
        rm -f "$TRIGGER_FILE"
        log_info "Trigger-File entfernt (verhindert Endlos-Loop)"
      fi

      # Remove lock
      rm -f "$LOCK_FILE"
    fi

    sleep "$POLL_INTERVAL"
  done
}

# Verify docker compose is available
check_prerequisites() {
  if ! docker compose version >/dev/null 2>&1; then
    log_error "docker compose nicht verfügbar!"
    # Try installing compose plugin
    if command -v apk >/dev/null 2>&1; then
      log_info "Versuche docker-compose-plugin zu installieren..."
      apk add --no-cache docker-compose-plugin 2>&1 || true
    fi
    if ! docker compose version >/dev/null 2>&1; then
      log_error "docker compose konnte nicht installiert werden. Abbruch."
      exit 1
    fi
  fi
  log_info "docker compose $(docker compose version --short 2>/dev/null || echo 'verfügbar')"

  if [ ! -f "$COMPOSE_FILE" ]; then
    log_error "Compose file nicht gefunden: ${COMPOSE_FILE}"
    exit 1
  fi
}

# Entry point
check_prerequisites
watch
