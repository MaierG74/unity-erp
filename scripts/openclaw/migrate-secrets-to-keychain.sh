#!/usr/bin/env bash
# Bulk-move plaintext secrets from ~/.openclaw/openclaw.json into macOS
# Keychain (account=openclaw) with -A so launchd / SSH / wrapper reads at
# boot don't prompt. Idempotent — re-running skips entries already present.
#
# DOES NOT remove the plaintext from openclaw.json — that's a separate
# manual step after you've verified start.sh boots cleanly (see runbook
# §3.4 / §3.5).
#
# Prints only service NAMES, never values.

set -euo pipefail

ACCOUNT="openclaw"
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"

if [ ! -f "$OPENCLAW_JSON" ]; then
  echo "FATAL: $OPENCLAW_JSON not found" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq not installed. Install with: brew install jq" >&2
  exit 1
fi

# Always back up first.
BACKUP="$OPENCLAW_JSON.pol113-backup.$(date -u +%Y%m%d%H%M%S)"
cp -p "$OPENCLAW_JSON" "$BACKUP"
echo "Backup → $BACKUP"
echo ""

migrate() {
  local service="$1" pointer="$2" label="$3"

  if security find-generic-password -a "$ACCOUNT" -s "$service" >/dev/null 2>&1; then
    echo "skip:   $service (already in Keychain)"
    return 0
  fi

  local value
  value=$(jq -r "$pointer // empty" "$OPENCLAW_JSON")
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "absent: $service (no value at $pointer)"
    return 0
  fi

  security add-generic-password \
    -a "$ACCOUNT" -s "$service" \
    -l "$label (POL-113 migrated $(date -u +%Y-%m-%d))" \
    -w "$value" -A
  echo "added:  $service"
}

# Service name             | jq pointer                       | human label
migrate qbutton_telegram_bot '.channels.telegram.botToken'    'OpenClaw Telegram bot token'
migrate gateway_auth_token   '.gateway.auth.token'             'OpenClaw gateway auth token'
migrate groq_api_key          '.env.GROQ_API_KEY'              'OpenClaw Groq API key'
migrate agent_flyer_api_key   '.env.AGENT_FLYER_API_KEY'       'flyer-agent bearer'

# Optional — only present in some installs.
migrate openai_api_key        '.env.OPENAI_API_KEY'            'OpenAI API key'
migrate gemini_api_key        '.env.GEMINI_API_KEY'            'Gemini API key'
migrate supabase_anon_key     '.env.SUPABASE_ANON_KEY'         'Supabase anon key'

echo ""
echo "Migration done. Plaintext is still in openclaw.json — strip it in a"
echo "separate step after start.sh boot verifies cleanly. See runbook §3.4."
echo ""
echo "To verify a value is readable from a fresh process:"
echo "  security find-generic-password -a $ACCOUNT -s qbutton_telegram_bot -w | wc -c"
