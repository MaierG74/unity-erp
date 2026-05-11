#!/usr/bin/env bash
# OpenClaw boot wrapper — loads secrets from macOS Keychain into the
# environment and exec's the OpenClaw runtime. Lives at ~/.openclaw/start.sh
# on ocmac-air; launchd ProgramArguments should point here.
#
# Fails fast if any required secret is missing — never silently degrades.
# See docs/operations/openclaw-secrets-runbook.md (POL-113) for context.

set -euo pipefail

ACCOUNT="openclaw"

fetch() {
  local service="$1"
  local value
  if ! value="$(security find-generic-password -a "$ACCOUNT" -s "$service" -w 2>/dev/null)"; then
    echo "FATAL: Keychain entry missing for service '$service' (account '$ACCOUNT')" >&2
    echo "       Run: security add-generic-password -a '$ACCOUNT' -s '$service' -w '<value>' -U" >&2
    exit 1
  fi
  printf '%s' "$value"
}

# Secrets — every value must be in Keychain for OpenClaw to boot.
export TELEGRAM_BOT_TOKEN="$(fetch qbutton_telegram_bot)"
export SUPABASE_ANON_KEY="$(fetch supabase_anon_key)"
export OPENAI_API_KEY="$(fetch openai_api_key)"
export GEMINI_API_KEY="$(fetch gemini_api_key)"
export GROQ_API_KEY="$(fetch groq_api_key)"
export PURCHASING_AGENT_API_KEY="$(fetch purchasing_agent_api_key)"

# Non-secret static config. Overridable via environment for testing.
export SUPABASE_URL="${SUPABASE_URL:-https://ttlyfhkrsjjrzxiagzpb.supabase.co}"
export GEMMA_OLLAMA_URL="${GEMMA_OLLAMA_URL:-http://100.115.147.8:11434}"

exec openclaw start --config "$HOME/.openclaw/openclaw.json"
