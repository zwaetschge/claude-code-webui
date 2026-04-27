#!/usr/bin/env bash
# install.sh — interactive installer for Claude Code WebUI.
#
# Walks the operator through: prereq check → .env generation → docker build →
# container start → health check → optional `claude /login` for first-time
# Claude OAuth so the wrapper has a working CLI on first launch.
#
# Re-runnable: existing .env values are kept unless --reset is passed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"

RESET=0
SKIP_LOGIN=0
NON_INTERACTIVE=0

usage() {
  cat <<USAGE
Usage: $0 [--reset] [--skip-login] [--non-interactive]

Options:
  --reset             Overwrite an existing .env from scratch instead of keeping current values
  --skip-login        Don't prompt for the interactive Claude /login at the end
  --non-interactive   Take all defaults; fail if a required value (FRONTEND_URL, allowlist email) isn't already set
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --skip-login) SKIP_LOGIN=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

c_reset=$'\033[0m'
c_bold=$'\033[1m'
c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_red=$'\033[31m'
c_cyan=$'\033[36m'

step() { printf '\n%s==>%s %s%s\n' "$c_cyan" "$c_reset" "$c_bold" "$1$c_reset"; }
ok()   { printf '%s✓%s %s\n' "$c_green" "$c_reset" "$1"; }
warn() { printf '%s!%s %s\n' "$c_yellow" "$c_reset" "$1" >&2; }
die()  { printf '%s✗%s %s\n' "$c_red" "$c_reset" "$1" >&2; exit 1; }

prompt() {
  # prompt VAR PROMPT [DEFAULT]
  local __var="$1" __prompt="$2" __default="${3:-}" __answer=""
  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    if [[ -z "$__default" ]]; then
      die "$__var has no value and --non-interactive is set"
    fi
    printf -v "$__var" '%s' "$__default"
    return
  fi
  if [[ -n "$__default" ]]; then
    printf '%s [%s]: ' "$__prompt" "$__default"
  else
    printf '%s: ' "$__prompt"
  fi
  IFS= read -r __answer || true
  if [[ -z "$__answer" ]]; then __answer="$__default"; fi
  printf -v "$__var" '%s' "$__answer"
}

# --- prereq check ---------------------------------------------------------
step "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die "docker not found in PATH. Install Docker Engine first: https://docs.docker.com/engine/install/"
ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"

if ! docker compose version >/dev/null 2>&1; then
  die "docker compose plugin not found. Install with: https://docs.docker.com/compose/install/"
fi
ok "docker compose $(docker compose version --short)"

if ! command -v openssl >/dev/null 2>&1; then
  die "openssl not found in PATH (needed to generate SESSION_SECRET / JWT_SECRET)"
fi
ok "openssl $(openssl version | awk '{print $2}')"

if ! docker info >/dev/null 2>&1; then
  die "docker daemon not reachable. Run \`docker ps\` and fix connectivity before continuing."
fi
ok "docker daemon reachable"

# --- existing .env handling -----------------------------------------------
declare -A EXISTING_ENV=()
load_existing_env() {
  if [[ -f "$ENV_FILE" && "$RESET" == "0" ]]; then
    while IFS='=' read -r k v; do
      [[ -z "$k" || "$k" =~ ^[[:space:]]*# ]] && continue
      [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
      v="${v%$'\r'}"
      v="${v#\"}"; v="${v%\"}"
      EXISTING_ENV["$k"]="$v"
    done < "$ENV_FILE"
    ok "Found existing .env — keeping current values (use --reset to wipe)"
  fi
}
load_existing_env

get_existing() { printf '%s' "${EXISTING_ENV[$1]:-}"; }

# --- env collection -------------------------------------------------------
step "Configuring .env"

WEBUI_PORT_DEFAULT="$(get_existing WEBUI_PORT)"
WEBUI_PORT_DEFAULT="${WEBUI_PORT_DEFAULT:-4545}"
prompt WEBUI_PORT "Host port to expose the WebUI on" "$WEBUI_PORT_DEFAULT"

FRONTEND_URL_DEFAULT="$(get_existing FRONTEND_URL)"
FRONTEND_URL_DEFAULT="${FRONTEND_URL_DEFAULT:-http://localhost:${WEBUI_PORT}}"
prompt FRONTEND_URL "Public URL the WebUI will be reached at" "$FRONTEND_URL_DEFAULT"

CORS_ORIGINS_DEFAULT="$(get_existing CORS_ALLOWED_ORIGINS)"
CORS_ORIGINS_DEFAULT="${CORS_ORIGINS_DEFAULT:-${FRONTEND_URL}}"
prompt CORS_ALLOWED_ORIGINS "Comma-separated CORS origins" "$CORS_ORIGINS_DEFAULT"

ALLOWED_EMAILS_DEFAULT="$(get_existing AUTH_ALLOWED_EMAILS)"
if [[ -z "$ALLOWED_EMAILS_DEFAULT" ]]; then
  warn "AUTH_ALLOWED_EMAILS is empty — leaving it that way means anyone with valid OAuth can sign in."
  warn "For a public deployment, list the operator email(s) here, comma-separated."
fi
prompt AUTH_ALLOWED_EMAILS "Allowed login emails (comma-separated, empty = no allowlist)" "$ALLOWED_EMAILS_DEFAULT"

SEED_ADMIN_DEFAULT="$(get_existing SEED_ADMIN_EMAIL)"
if [[ -z "$SEED_ADMIN_DEFAULT" && -n "$AUTH_ALLOWED_EMAILS" ]]; then
  SEED_ADMIN_DEFAULT="${AUTH_ALLOWED_EMAILS%%,*}"
fi
prompt SEED_ADMIN_EMAIL "Bootstrap admin email (gets role=admin on first login)" "$SEED_ADMIN_DEFAULT"

WORKSPACE_DEFAULT="$(get_existing WORKSPACE_DIR)"
WORKSPACE_DEFAULT="${WORKSPACE_DEFAULT:-./workspace}"
prompt WORKSPACE_DIR "Host path mounted to /workspace inside the container" "$WORKSPACE_DEFAULT"

DATA_DIR_DEFAULT="$(get_existing DATA_DIR)"
DATA_DIR_DEFAULT="${DATA_DIR_DEFAULT:-./data}"
prompt DATA_DIR "Host path for SQLite DB and generated files" "$DATA_DIR_DEFAULT"

CONFIG_DIR_DEFAULT="$(get_existing CONFIG_DIR)"
CONFIG_DIR_DEFAULT="${CONFIG_DIR_DEFAULT:-./config}"
prompt CONFIG_DIR "Host path for per-CLI config (claude, codex, opencode)" "$CONFIG_DIR_DEFAULT"

SESSION_SECRET="$(get_existing SESSION_SECRET)"
if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  ok "Generated SESSION_SECRET"
else
  ok "Keeping existing SESSION_SECRET"
fi

JWT_SECRET="$(get_existing JWT_SECRET)"
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  ok "Generated JWT_SECRET"
else
  ok "Keeping existing JWT_SECRET"
fi

# --- write .env -----------------------------------------------------------
step "Writing $ENV_FILE"

umask 077
cat > "$ENV_FILE" <<ENV
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Edit by hand or re-run: ./scripts/install.sh

WEBUI_PORT=${WEBUI_PORT}
FRONTEND_URL=${FRONTEND_URL}
CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}
AUTH_ALLOWED_EMAILS=${AUTH_ALLOWED_EMAILS}
SEED_ADMIN_EMAIL=${SEED_ADMIN_EMAIL}

WORKSPACE_DIR=${WORKSPACE_DIR}
DATA_DIR=${DATA_DIR}
CONFIG_DIR=${CONFIG_DIR}

SESSION_SECRET=${SESSION_SECRET}
JWT_SECRET=${JWT_SECRET}

# Optional: OAuth providers — fill in to enable
GITHUB_CLIENT_ID=$(get_existing GITHUB_CLIENT_ID)
GITHUB_CLIENT_SECRET=$(get_existing GITHUB_CLIENT_SECRET)
GITHUB_CALLBACK_URL=$(get_existing GITHUB_CALLBACK_URL)
GOOGLE_CLIENT_ID=$(get_existing GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(get_existing GOOGLE_CLIENT_SECRET)
GOOGLE_CALLBACK_URL=$(get_existing GOOGLE_CALLBACK_URL)
ENV
ok "Wrote .env (mode 600)"

# --- create host dirs the compose volumes will need -----------------------
step "Creating host directories"
mkdir -p \
  "${DATA_DIR}" \
  "${CONFIG_DIR}/claude" \
  "${CONFIG_DIR}/codex" \
  "${CONFIG_DIR}/opencode" \
  "${CONFIG_DIR}/npm-global" \
  "${WORKSPACE_DIR}"
ok "Directories ready"

# --- build & start --------------------------------------------------------
step "Building image (this can take several minutes on first run)"
( cd "$ROOT_DIR" && docker compose build claude-code-webui )
ok "Build complete"

step "Starting container"
( cd "$ROOT_DIR" && docker compose up -d claude-code-webui )

# --- health wait ----------------------------------------------------------
step "Waiting for /health"
container_id="$(cd "$ROOT_DIR" && docker compose ps -q claude-code-webui)"
if [[ -z "$container_id" ]]; then die "claude-code-webui container did not start"; fi

healthy=0
for _ in $(seq 1 60); do
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id" 2>/dev/null || echo none)"
  if [[ "$status" == "healthy" ]]; then healthy=1; break; fi
  if [[ "$status" == "none" ]]; then
    # No healthcheck configured — fall back to plain HTTP check
    if curl -fsS "http://127.0.0.1:${WEBUI_PORT}/health" >/dev/null 2>&1; then healthy=1; break; fi
  fi
  sleep 2
done

if [[ "$healthy" != "1" ]]; then
  warn "Container didn't report healthy within 120s. Check logs: docker compose logs -f claude-code-webui"
else
  ok "WebUI is healthy at ${FRONTEND_URL}"
fi

# --- claude /login --------------------------------------------------------
if [[ "$SKIP_LOGIN" == "0" && "$NON_INTERACTIVE" == "0" ]]; then
  step "Claude CLI first-time login"
  cat <<NOTE
The Claude CLI inside the container needs to be linked to your Anthropic
account once. This will open the interactive Claude TUI in your terminal —
type \`/login\` and follow the OAuth prompts. Press Ctrl+D / Ctrl+C to exit
when you're done.

NOTE
  printf 'Run claude /login now? [Y/n]: '
  IFS= read -r run_login || run_login=""
  case "${run_login,,}" in
    n|no) warn "Skipped — run \`docker exec -it claude-code-webui claude\` later and type /login" ;;
    *)
      if ! docker exec -it claude-code-webui claude 2>/dev/null; then
        warn "Couldn't attach to claude CLI. Try manually: docker exec -it claude-code-webui claude"
      fi
      ;;
  esac
fi

# --- summary --------------------------------------------------------------
step "Done"
cat <<SUMMARY
${c_bold}Claude Code WebUI is up.${c_reset}

  URL:            ${c_green}${FRONTEND_URL}${c_reset}
  Container:      claude-code-webui (port ${WEBUI_PORT})
  Allowed emails: ${AUTH_ALLOWED_EMAILS:-<none — open signup>}
  Admin seed:     ${SEED_ADMIN_EMAIL:-<unset>}

Useful commands:
  docker compose logs -f claude-code-webui
  docker compose restart claude-code-webui
  docker exec -it claude-code-webui claude          # interactive Claude CLI
  docker exec -it claude-code-webui codex           # interactive Codex CLI

To re-run the installer (preserves existing .env): ./scripts/install.sh
To start over from scratch:                       ./scripts/install.sh --reset
SUMMARY
