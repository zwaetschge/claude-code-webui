#!/bin/bash
#
# 🤖 REBUILD ROBOT - Außenreparaturroboter für Plum Code WebUI
#
# Dieser Robot läuft auf dem HOST (nicht im Container) und überwacht
# Rebuild-Requests. Wenn ein Request erkannt wird, führt er den Rebuild
# sicher von außen durch und berichtet den Status zurück.
#
# Usage:
#   ./rebuild-robot.sh watch    # Startet den Watcher-Modus
#   ./rebuild-robot.sh rebuild  # Führt einen Rebuild sofort aus
#   ./rebuild-robot.sh status   # Zeigt aktuellen Status
#

set -e

# Konfiguration
WEBUI_DIR="/mnt/user/appdata/claude-code-webui"
TRIGGER_FILE="${WEBUI_DIR}/data/rebuild-trigger.json"
STATUS_FILE="${WEBUI_DIR}/data/rebuild-robot-status.json"
REPORT_FILE="${WEBUI_DIR}/REBUILD_ROBOT_REPORT.md"
LOG_FILE="${WEBUI_DIR}/data/rebuild-robot.log"
LOCK_FILE="/tmp/rebuild-robot.lock"
POLL_INTERVAL=5  # Sekunden zwischen Checks

# Farben für Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging
log() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [${level}] ${message}" | tee -a "$LOG_FILE"
}

log_info() { log "INFO" "$1"; }
log_warn() { log "${YELLOW}WARN${NC}" "$1"; }
log_error() { log "${RED}ERROR${NC}" "$1"; }
log_success() { log "${GREEN}SUCCESS${NC}" "$1"; }

# Robot ASCII Art
print_robot() {
    echo -e "${CYAN}"
    cat << 'EOF'
    ╔═══════════════════════════════════════════╗
    ║  🤖 REBUILD ROBOT v1.0                    ║
    ║  Außenreparaturroboter für Plum Code      ║
    ╚═══════════════════════════════════════════╝
         [◉_◉]
        /|███|\
         |███|
        /  |  \
EOF
    echo -e "${NC}"
}

# Status in JSON schreiben
write_status() {
    local status="$1"
    local message="$2"
    local phase="$3"
    local timestamp=$(date -Iseconds)

    cat > "$STATUS_FILE" << EOF
{
  "status": "${status}",
  "message": "${message}",
  "phase": "${phase}",
  "timestamp": "${timestamp}",
  "robot_version": "1.0"
}
EOF
}

# Detaillierten Report schreiben
write_report() {
    local status="$1"
    local start_time="$2"
    local end_time="$3"
    local build_output="$4"
    local error_message="$5"

    local duration=$((end_time - start_time))
    local status_emoji="✅"
    local status_text="ERFOLGREICH"

    if [ "$status" != "success" ]; then
        status_emoji="❌"
        status_text="FEHLGESCHLAGEN"
    fi

    cat > "$REPORT_FILE" << EOF
# 🤖 Rebuild Robot Report

## Status: ${status_emoji} ${status_text}

| Feld | Wert |
|------|------|
| Gestartet | $(date -d "@$start_time" '+%Y-%m-%d %H:%M:%S') |
| Beendet | $(date -d "@$end_time" '+%Y-%m-%d %H:%M:%S') |
| Dauer | ${duration} Sekunden |
| Robot Version | 1.0 |

## Phasen

### Phase 1: Build
\`\`\`
docker compose build
\`\`\`

### Phase 2: Container Stop
\`\`\`
docker compose down --remove-orphans
\`\`\`

### Phase 3: Container Start
\`\`\`
docker compose up -d
\`\`\`

EOF

    if [ -n "$error_message" ]; then
        cat >> "$REPORT_FILE" << EOF
## Fehler

\`\`\`
${error_message}
\`\`\`

EOF
    fi

    cat >> "$REPORT_FILE" << EOF
## Build Output (letzte 50 Zeilen)

\`\`\`
${build_output}
\`\`\`

---
*Report generiert von Rebuild Robot 🤖*
EOF
}

# Rebuild ausführen
do_rebuild() {
    local no_cache="${1:-false}"
    local start_time=$(date +%s)
    local build_output=""
    local error_message=""

    log_info "🚀 Rebuild Robot startet..."
    write_status "building" "Docker Image wird gebaut..." "build"

    # Phase 1: Build
    log_info "Phase 1: Building Docker image..."

    local build_cmd="docker compose build"
    if [ "$no_cache" = "true" ]; then
        build_cmd="docker compose build --no-cache"
    fi

    cd "$WEBUI_DIR"

    if build_output=$($build_cmd 2>&1); then
        log_success "Build erfolgreich!"
    else
        log_error "Build fehlgeschlagen!"
        error_message="Build failed: $build_output"
        write_status "error" "$error_message" "build"
        write_report "error" "$start_time" "$(date +%s)" "$build_output" "$error_message"
        return 1
    fi

    # Phase 2: Container stoppen
    log_info "Phase 2: Stopping container..."
    write_status "stopping" "Container wird gestoppt..." "stop"

    if docker compose down --remove-orphans 2>&1; then
        log_success "Container gestoppt!"
    else
        log_warn "Container stoppen hatte Probleme, versuche fortzufahren..."
    fi

    # Kurze Pause für Cleanup
    sleep 2

    # Phase 3: Container starten
    log_info "Phase 3: Starting new container..."
    write_status "starting" "Neuer Container wird gestartet..." "start"

    if docker compose up -d 2>&1; then
        log_success "Container gestartet!"
    else
        log_error "Container Start fehlgeschlagen!"
        error_message="Container start failed"
        write_status "error" "$error_message" "start"
        write_report "error" "$start_time" "$(date +%s)" "$build_output" "$error_message"
        return 1
    fi

    # Warten auf Container-Startup
    log_info "Warte auf Container-Startup..."
    sleep 5

    # Verifizieren
    if docker ps | grep -q "claude-code-webui"; then
        log_success "🎉 Rebuild erfolgreich abgeschlossen!"
        write_status "success" "Rebuild erfolgreich abgeschlossen" "complete"
        write_report "success" "$start_time" "$(date +%s)" "$(echo "$build_output" | tail -50)" ""

        # Trigger-File löschen
        rm -f "$TRIGGER_FILE"

        return 0
    else
        log_error "Container läuft nicht!"
        error_message="Container is not running after rebuild"
        write_status "error" "$error_message" "verify"
        write_report "error" "$start_time" "$(date +%s)" "$build_output" "$error_message"
        return 1
    fi
}

# Auf Trigger warten
watch_for_trigger() {
    print_robot
    log_info "🔭 Rebuild Robot im Watcher-Modus gestartet"
    log_info "Überwache: $TRIGGER_FILE"
    log_info "Poll-Interval: ${POLL_INTERVAL}s"

    write_status "watching" "Warte auf Rebuild-Request..." "idle"

    while true; do
        if [ -f "$TRIGGER_FILE" ]; then
            log_info "📥 Trigger-File erkannt!"

            # Trigger-Optionen lesen
            local no_cache="false"
            if [ -f "$TRIGGER_FILE" ]; then
                no_cache=$(cat "$TRIGGER_FILE" | grep -o '"noCache"[[:space:]]*:[[:space:]]*true' && echo "true" || echo "false")
            fi

            # Lock setzen
            if [ -f "$LOCK_FILE" ]; then
                log_warn "Rebuild bereits in Progress, überspringe..."
                sleep "$POLL_INTERVAL"
                continue
            fi
            touch "$LOCK_FILE"

            # Rebuild ausführen
            if do_rebuild "$no_cache"; then
                log_success "✅ Rebuild erfolgreich!"
                # Keep "success" status for 30s so the container can read it on startup
                log_info "Warte 30s damit Container den Status lesen kann..."
                sleep 30
            else
                log_error "❌ Rebuild fehlgeschlagen!"
            fi

            # Lock entfernen
            rm -f "$LOCK_FILE"

            write_status "watching" "Warte auf nächsten Rebuild-Request..." "idle"
        fi

        sleep "$POLL_INTERVAL"
    done
}

# Status anzeigen
show_status() {
    print_robot

    if [ -f "$STATUS_FILE" ]; then
        echo -e "${BLUE}=== Aktueller Status ===${NC}"
        cat "$STATUS_FILE" | python3 -m json.tool 2>/dev/null || cat "$STATUS_FILE"
        echo ""
    else
        echo "Kein Status-File gefunden."
    fi

    if [ -f "$REPORT_FILE" ]; then
        echo -e "${BLUE}=== Letzter Report ===${NC}"
        head -30 "$REPORT_FILE"
        echo "..."
        echo "(Vollständiger Report in $REPORT_FILE)"
    fi
}

# Hauptprogramm
case "${1:-}" in
    watch)
        watch_for_trigger
        ;;
    rebuild)
        print_robot
        do_rebuild "${2:-false}"
        ;;
    status)
        show_status
        ;;
    *)
        print_robot
        echo "Usage: $0 {watch|rebuild|status}"
        echo ""
        echo "Commands:"
        echo "  watch   - Startet den Watcher-Modus (wartet auf Trigger-File)"
        echo "  rebuild - Führt einen Rebuild sofort aus"
        echo "  status  - Zeigt aktuellen Status"
        echo ""
        echo "Der Robot überwacht: $TRIGGER_FILE"
        echo "Status wird geschrieben nach: $STATUS_FILE"
        echo "Report wird geschrieben nach: $REPORT_FILE"
        exit 1
        ;;
esac
