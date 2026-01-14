#!/bin/bash
# Permission prompt wrapper script for Claude Code WebUI
# This script is called by Claude CLI via --permission-prompt-tool

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec npx tsx "$SCRIPT_DIR/permission-prompt.ts"
