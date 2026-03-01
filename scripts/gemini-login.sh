#!/bin/bash
# Gemini CLI Login Script
# Run this to authenticate Gemini CLI with your Google account.
#
# Usage:
#   docker exec -it claude-code-webui bash /app/scripts/gemini-login.sh
#
# What it does:
# 1. Configures Gemini CLI for Google Login (oauth-personal)
# 2. Starts the interactive auth flow
# 3. You'll get a URL to open in your browser
# 4. After Google login, copy the authorization code
# 5. Paste it back here
# 6. Done! Credentials are saved for future sessions.

set -e

GEMINI_DIR="${HOME}/.gemini"
SETTINGS_FILE="${GEMINI_DIR}/settings.json"

echo "=== Gemini CLI Login ==="
echo ""

# Ensure settings.json has oauth-personal auth type
mkdir -p "${GEMINI_DIR}"

if [ -f "${SETTINGS_FILE}" ]; then
  # Check if settings.json already has auth config
  if node -e "
    const s = JSON.parse(require('fs').readFileSync('${SETTINGS_FILE}', 'utf-8'));
    process.exit(s?.security?.auth?.selectedType === 'oauth-personal' ? 0 : 1);
  " 2>/dev/null; then
    echo "Auth type already set to oauth-personal."
  else
    echo "Setting auth type to oauth-personal..."
    node -e "
      const fs = require('fs');
      let s = {};
      try { s = JSON.parse(fs.readFileSync('${SETTINGS_FILE}', 'utf-8')); } catch {}
      if (!s.security) s.security = {};
      if (!s.security.auth) s.security.auth = {};
      s.security.auth.selectedType = 'oauth-personal';
      fs.writeFileSync('${SETTINGS_FILE}', JSON.stringify(s, null, 2));
    "
  fi
else
  echo "Creating settings.json with oauth-personal auth..."
  cat > "${SETTINGS_FILE}" << 'EOF'
{
  "security": {
    "auth": {
      "selectedType": "oauth-personal"
    }
  }
}
EOF
fi

echo ""
echo "Starting Gemini CLI auth flow..."
echo "A URL will appear. Open it in your browser and sign in with Google."
echo "Then paste the authorization code back here."
echo ""

# Run gemini interactively - it will show the URL and wait for the code
gemini --prompt "say ok"
