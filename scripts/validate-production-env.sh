#!/bin/sh

# Fail-closed production authentication preflight. This script deliberately
# reports variable names only; it never echoes secret values.

set -eu

fail() {
  printf 'production configuration rejected: %s\n' "$1" >&2
  exit 1
}

require_secret() {
  _name="$1"
  _value="$2"

  [ "${#_value}" -ge 32 ] || fail "${_name} must contain at least 32 characters"
  _normalized=$(printf '%s' "$_value" | tr '[:upper:]' '[:lower:]')
  case "$_normalized" in
    changeme*|change-me*|replace-me*|replace_this*|example*|default*|your-*|your_*|test-*|test_*|secret)
      fail "${_name} still contains a known placeholder"
      ;;
  esac
}

SESSION_SECRET="${SESSION_SECRET:-}"
JWT_SECRET="${JWT_SECRET:-}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"
AUTH_ALLOWED_EMAILS="${AUTH_ALLOWED_EMAILS:-}"

require_secret "SESSION_SECRET" "$SESSION_SECRET"
require_secret "JWT_SECRET" "$JWT_SECRET"
require_secret "ENCRYPTION_KEY" "$ENCRYPTION_KEY"

[ "$SESSION_SECRET" != "$JWT_SECRET" ] || fail "SESSION_SECRET and JWT_SECRET must be different"
[ "$ENCRYPTION_KEY" != "$SESSION_SECRET" ] || fail "ENCRYPTION_KEY must be independent from SESSION_SECRET"
[ "$ENCRYPTION_KEY" != "$JWT_SECRET" ] || fail "ENCRYPTION_KEY must be independent from JWT_SECRET"

_allowlist_valid=false
_old_ifs=$IFS
IFS=,
for _candidate in $AUTH_ALLOWED_EMAILS; do
  _candidate=$(printf '%s' "$_candidate" | tr -d '[:space:]')
  case "$_candidate" in
    ?*@?*)
      _allowlist_valid=true
      break
      ;;
  esac
done
IFS=$_old_ifs

[ "$_allowlist_valid" = "true" ] || fail "AUTH_ALLOWED_EMAILS must contain at least one email address"

printf 'production configuration accepted\n'
