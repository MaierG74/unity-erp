#!/usr/bin/env bash
# Rotate Sam's API key. Generates a fresh plaintext, stores it in macOS
# Keychain on ocmac-air (overwriting the previous), prints the new SHA-256
# hash to stdout. The OLD hash in public.agent_credentials should be left
# active until the new key is verified end-to-end, then deactivated — see
# the two-step pattern in docs/operations/openclaw-secrets-runbook.md §4.2.

set -euo pipefail

SERVICE="purchasing_agent_api_key"
ACCOUNT="openclaw"

# Refuse if no prior key exists — use issue-* for the initial bootstrap.
if ! security find-generic-password -a "$ACCOUNT" -s "$SERVICE" >/dev/null 2>&1; then
  echo "FATAL: No existing '$SERVICE' for account '$ACCOUNT'." >&2
  echo "       Use issue-purchasing-agent-key.sh for the initial issuance." >&2
  exit 1
fi

NEW_PLAINTEXT=$(openssl rand -hex 32)
# -A + -U: allow all apps owned by this user (no per-launch prompt at boot),
# and update the existing entry in place. See issue-purchasing-agent-key.sh
# for the threat-model rationale.
security add-generic-password -a "$ACCOUNT" -s "$SERVICE" \
  -l "OpenClaw Sam API key (rotated $(date -u +%Y-%m-%d))" \
  -w "$NEW_PLAINTEXT" -A -U

NEW_HASH=$(printf '%s' "$NEW_PLAINTEXT" | shasum -a 256 | awk '{print $1}')
unset NEW_PLAINTEXT

cat <<EOF
New SHA-256 hash:

  $NEW_HASH

Two-step rotation (see runbook §4.2):

  -- Step 1: add a new active row alongside the old one (no auth gap).
  INSERT INTO public.agent_credentials (agent_id, org_id, api_key_hash, label, is_active)
  VALUES (
    'purchasing-agent',
    '99183187-da8e-4ce1-b28a-d08cc70cd7d4',
    '$NEW_HASH',
    'Sam rotated $(date -u +%Y-%m-%d)',
    true
  );

  -- Step 2: restart OpenClaw (launchctl unload + load) so Sam picks up the
  --         new value from Keychain.

  -- Step 3: AFTER verifying the new key works end-to-end, deactivate the old
  --         row. (Find the old hash in agent_credentials by agent_id /
  --         created_at ORDER.)
  UPDATE public.agent_credentials
     SET is_active = false,
         label = label || ' (rotated out $(date -u +%Y-%m-%d))'
   WHERE agent_id = 'purchasing-agent'
     AND org_id = '99183187-da8e-4ce1-b28a-d08cc70cd7d4'
     AND api_key_hash = '<old hash>';
EOF
