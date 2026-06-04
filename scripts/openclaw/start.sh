#!/usr/bin/env bash
# OpenClaw boot wrapper — loads secrets from macOS Keychain into the
# environment and exec's the OpenClaw runtime. Lives at ~/.openclaw/start.sh
# on ocmac-air; launchd ProgramArguments should point here.
#
# Required secrets fail boot fast with a clear error. Optional secrets are
# loaded if present and silently empty otherwise (some installs don't use
# OpenAI/Gemini cloud routing — Matt currently uses GROQ only).
#
# See docs/operations/openclaw-secrets-runbook.md (POL-113) for context.

set -euo pipefail

ACCOUNT="openclaw"

fetch() {
  local service="$1"
  local value
  if ! value="$(security find-generic-password -a "$ACCOUNT" -s "$service" -w 2>/dev/null)"; then
    echo "FATAL: Keychain entry missing for service '$service' (account '$ACCOUNT')" >&2
    echo "       Run: security add-generic-password -a '$ACCOUNT' -s '$service' -w '<value>' -A -U" >&2
    exit 1
  fi
  printf '%s' "$value"
}

fetch_optional() {
  local service="$1"
  security find-generic-password -a "$ACCOUNT" -s "$service" -w 2>/dev/null || printf ''
}

# Required — boot fails without these.
export TELEGRAM_BOT_TOKEN="$(fetch qbutton_telegram_bot)"
export GATEWAY_AUTH_TOKEN="$(fetch gateway_auth_token)"
export GROQ_API_KEY="$(fetch groq_api_key)"
export AGENT_FLYER_API_KEY="$(fetch agent_flyer_api_key)"
export PURCHASING_AGENT_API_KEY="$(fetch purchasing_agent_api_key)"

# Optional — only set if present in Keychain.
OPENAI_API_KEY="$(fetch_optional openai_api_key)"; [ -n "$OPENAI_API_KEY" ] && export OPENAI_API_KEY
GEMINI_API_KEY="$(fetch_optional gemini_api_key)"; [ -n "$GEMINI_API_KEY" ] && export GEMINI_API_KEY
SUPABASE_ANON_KEY="$(fetch_optional supabase_anon_key)"; [ -n "$SUPABASE_ANON_KEY" ] && export SUPABASE_ANON_KEY

# Static, non-secret config. Overridable via environment for testing.
export SUPABASE_URL="${SUPABASE_URL:-https://ttlyfhkrsjjrzxiagzpb.supabase.co}"
export SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ttlyfhkrsjjrzxiagzpb}"
export QBUTTON_ORG_ID="${QBUTTON_ORG_ID:-99183187-da8e-4ce1-b28a-d08cc70cd7d4}"
export GEMMA_OLLAMA_URL="${GEMMA_OLLAMA_URL:-http://100.115.147.8:11434}"

# Boot the OpenClaw gateway. Mirrors the launchd plist's ProgramArguments
# but with secrets sourced from Keychain instead of plaintext-in-plist.
# Override OPENCLAW_GATEWAY_PORT for side-by-side testing while a
# launchd-managed gateway already holds :18789.
exec openclaw gateway --port "${OPENCLAW_GATEWAY_PORT:-18789}"
