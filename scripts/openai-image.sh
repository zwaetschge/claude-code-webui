#!/usr/bin/env bash
# openai-image.sh — generate or edit an image via OpenAI's Images API.
#
# Provides a minimal wrapper so CLI sessions (Codex, etc.) can do batch /
# reproducible asset generation without installing a third-party `openai` CLI.
# Uses `curl + jq + base64` which are already in the container image.
#
# Counts against OpenAI API billing (your $OPENAI_API_KEY). For Codex-plan-
# metered generation, prefer Codex CLI's built-in `$imagegen` command instead.
#
# Usage (generate):
#   openai-image.sh generate \
#     --prompt "a clean rack-server icon, dark UI, no text, 1024x1024" \
#     --output assets/icon-server.png
#
# Usage (edit):
#   openai-image.sh edit \
#     --image input.png \
#     --prompt "same style, more minimal background, no text" \
#     --output edited.png
#
# Flags:
#   --prompt TEXT       prompt (required)
#   --output PATH       where to save the PNG (required)
#   --image PATH        reference image (only for `edit` subcommand)
#   --model NAME        model id (default: gpt-image-2)
#   --size WxH          1024x1024 | 1536x1024 | 1024x1536 | auto (default: auto)
#   --quality LEVEL     low | medium | high | auto (default: auto)
#   --n COUNT           number of images (default: 1)
#   --background MODE   transparent | opaque | auto — gpt-image-2 may reject transparent
#
# Exit codes: 0 = ok, 1 = bad arguments, 2 = API error, 3 = decode failure.

set -euo pipefail

API_BASE="${OPENAI_API_BASE:-https://api.openai.com/v1}"
DEFAULT_MODEL="gpt-image-2"

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ $# -eq 0 ]; then
  usage
  exit 0
fi

CMD="$1"; shift || true
case "$CMD" in
  generate|edit) ;;
  *)
    echo "error: first argument must be 'generate' or 'edit', got '$CMD'" >&2
    usage >&2
    exit 1
    ;;
esac

PROMPT=""
OUTPUT=""
IMAGE=""
MODEL="$DEFAULT_MODEL"
SIZE="auto"
QUALITY="auto"
N=1
BACKGROUND=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prompt) PROMPT="$2"; shift 2 ;;
    --output) OUTPUT="$2"; shift 2 ;;
    --image)  IMAGE="$2";  shift 2 ;;
    --model)  MODEL="$2";  shift 2 ;;
    --size)   SIZE="$2";   shift 2 ;;
    --quality) QUALITY="$2"; shift 2 ;;
    --n)      N="$2";      shift 2 ;;
    --background) BACKGROUND="$2"; shift 2 ;;
    *)
      echo "error: unknown flag '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "error: OPENAI_API_KEY not set" >&2
  exit 1
fi
if [ -z "$PROMPT" ] || [ -z "$OUTPUT" ]; then
  echo "error: --prompt and --output are required" >&2
  exit 1
fi
if [ "$CMD" = "edit" ] && [ -z "$IMAGE" ]; then
  echo "error: edit requires --image" >&2
  exit 1
fi

# Resolve absolute output path and ensure parent exists.
OUT_DIR=$(dirname -- "$OUTPUT")
mkdir -p "$OUT_DIR"

# Run the call. The Images API returns `data[0].b64_json` we decode into a PNG.
if [ "$CMD" = "generate" ]; then
  JSON=$(jq -n \
    --arg model "$MODEL" --arg prompt "$PROMPT" --arg size "$SIZE" \
    --arg quality "$QUALITY" --argjson n "$N" \
    --arg bg "$BACKGROUND" \
    '{model: $model, prompt: $prompt, size: $size, quality: $quality, n: $n}
     + (if $bg == "" then {} else {background: $bg} end)')
  RESP=$(curl -sS --fail-with-body -X POST "$API_BASE/images/generations" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -H "Content-Type: application/json" \
    --data "$JSON") || {
      echo "error: OpenAI API call failed" >&2
      printf '%s\n' "$RESP" >&2
      exit 2
    }
else
  # Multipart upload for edit.
  CURL_ARGS=(-sS --fail-with-body -X POST "$API_BASE/images/edits"
    -H "Authorization: Bearer $OPENAI_API_KEY"
    -F "model=$MODEL"
    -F "prompt=$PROMPT"
    -F "size=$SIZE"
    -F "quality=$QUALITY"
    -F "n=$N"
    -F "image=@$IMAGE")
  if [ -n "$BACKGROUND" ]; then CURL_ARGS+=(-F "background=$BACKGROUND"); fi
  RESP=$(curl "${CURL_ARGS[@]}") || {
    echo "error: OpenAI API call failed" >&2
    printf '%s\n' "$RESP" >&2
    exit 2
  }
fi

# Validate response shape before touching disk.
if ! echo "$RESP" | jq -e '.data[0].b64_json' >/dev/null 2>&1; then
  echo "error: unexpected API response (no data[].b64_json)" >&2
  echo "$RESP" | head -c 1000 >&2
  echo >&2
  exit 3
fi

# Single output or batch. For N > 1, suffix _N to the filename.
if [ "$N" -gt 1 ]; then
  i=0
  while [ "$i" -lt "$N" ]; do
    target="${OUTPUT%.*}_$((i+1)).${OUTPUT##*.}"
    echo "$RESP" | jq -r ".data[$i].b64_json" | base64 -d > "$target"
    echo "$target"
    i=$((i+1))
  done
else
  echo "$RESP" | jq -r '.data[0].b64_json' | base64 -d > "$OUTPUT"
  echo "$OUTPUT"
fi
