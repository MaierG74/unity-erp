#!/usr/bin/env bash
# One-shot: generate Sam's API key, store the plaintext in macOS Keychain on
# ocmac-air, print only the SHA-256 hash to stdout. Run this ONCE during the
# POL-113 initial migration; for routine rotation use rotate-purchasing-agent-key.sh.
#
# The hash printed to stdout is what gets inserted into
# public.agent_credentials.api_key_hash. The plaintext never leaves ocmac-air.
#
# See docs/operations/openclaw-secrets-runbook.md §3.1.

set -euo pipefail

SERVICE="purchasing_agent_api_key"
ACCOUNT="openclaw"

# Refuse to overwrite if a key already exists — use rotate-* instead.
if security find-generic-password -a "$ACCOUNT" -s "$SERVICE" >/dev/null 2>&1; then
  echo "FATAL: Keychain already has '$SERVICE' for account '$ACCOUNT'." >&2
  echo "       Use rotate-purchasing-agent-key.sh for rotation, or delete first:" >&2
  echo "         security delete-generic-password -a '$ACCOUNT' -s '$SERVICE'" >&2
  exit 1
fi

PLAINTEXT=$(openssl rand -hex 32)
security add-generic-password \
  -a "$ACCOUNT" -s "$SERVICE" \
  -l "OpenClaw Sam API key (POL-113 initial issuance $(date -u +%Y-%m-%d))" \
  -w "$PLAINTEXT"

HASH=$(printf '%s' "$PLAINTEXT" | shasum -a 256 | awk '{print $1}')
unset PLAINTEXT

cat <<EOF
SHA-256 hash to insert into public.agent_credentials.api_key_hash:

  $HASH

Then INSERT in Supabase (from a Claude Code session via execute_sql, or the
SQL editor):

  INSERT INTO public.agent_credentials (agent_id, org_id, api_key_hash, label, is_active)
  VALUES (
    'purchasing-agent',
    '99183187-da8e-4ce1-b28a-d08cc70cd7d4',
    '$HASH',
    'Sam (purchasing agent) — POL-113 initial issuance',
    true
  );
EOF
