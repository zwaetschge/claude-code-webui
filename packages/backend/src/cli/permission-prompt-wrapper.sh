#!/bin/bash
# Permission prompt wrapper script for Plum Code WebUI
# This script is called by Claude CLI via --permission-prompt-tool

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPILED_SCRIPT="$SCRIPT_DIR/../../dist/cli/permission-prompt.js"

if [ -f "$COMPILED_SCRIPT" ]; then
  exec node "$COMPILED_SCRIPT"
fi

# Development fallback for source checkouts that have not built dist yet.
exec npx --no-install tsx "$SCRIPT_DIR/permission-prompt.ts"
