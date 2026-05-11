# OpenClaw secrets runbook

**Status:** active as of 2026-05-11 (POL-113)
**Scope:** every secret consumed by the OpenClaw runtime on `ocmac-air` —
Telegram bot tokens, Supabase keys, cloud LLM keys, agent API keys.
**Goal:** zero plaintext secrets on disk outside macOS Keychain; deterministic
rotation; boot-time fast-fail when any required secret is missing.

This is the canonical reference for POL-113. The plan §7.2 describes the
target shape; this doc is the operational implementation.

---

## 1. Why this exists

The original `~/.openclaw/openclaw.json` carried plaintext API keys for every
external service Sam (and Matt) talks to. Anyone with read access to the file
— a backup process, a stolen Time Machine snapshot, a curl-against-localhost
debug tool — gets every secret at once. POL-113 moves all of them into macOS
Keychain, loaded into the OpenClaw process's environment by a wrapper script
that runs ONLY at boot.

Trade-off: Keychain entries are encrypted at rest and unlocked per-user-session.
A lost-or-locked-out Keychain means OpenClaw can't start until the secrets are
re-issued. The recovery procedure in §5 covers that.

---

## 2. Inventory of secrets

| Keychain service name        | Used by                                          | Rotation cadence | Owner of canonical value |
| ---------------------------- | ------------------------------------------------ | ---------------- | ------------------------ |
| `qbutton_telegram_bot`       | Matt + Sam Telegram clients                      | On compromise; quarterly | BotFather              |
| `supabase_service_role`      | Edge Function secrets (NOT the OpenClaw runtime) | On compromise; quarterly | Supabase dashboard     |
| `supabase_anon_key`          | OpenClaw read paths via PostgREST                | On compromise; quarterly | Supabase dashboard     |
| `openai_api_key`             | Matt's cloud routing fallback                    | Quarterly        | OpenAI console          |
| `gemini_api_key`             | Matt's cloud routing fallback                    | Quarterly        | AI Studio               |
| `groq_api_key`               | Matt's cloud routing fallback                    | Quarterly        | Groq console            |
| `purchasing_agent_api_key`   | Sam's HTTP auth to `agent-closure-rpc`           | Quarterly        | Generated on ocmac-air; hash stored in `public.agent_credentials` |

**Crucial separation:** the Supabase service-role key MUST NOT live on
ocmac-air. It belongs in Supabase Edge Function secrets, where it's
accessible to `agent-send-flyer` / `agent-closure-rpc` but invisible to any
client. Sam's local credential is `purchasing_agent_api_key`, which the
Edge Function validates against `agent_credentials.api_key_hash`.

---

## 3. One-time setup on ocmac-air

Run each block once. The `security` command writes to the login keychain by
default; `-U` updates if the entry already exists.

### 3.1 Issue Sam's API key

This is the only secret OpenClaw owns end-to-end — it's not a vendor key.
Run this on `ocmac-air` to generate the plaintext, store it in Keychain, and
print ONLY the SHA-256 hash. Paste the hash back to whoever is wiring up
`agent_credentials`.

```bash
#!/usr/bin/env bash
# scripts/openclaw/issue-purchasing-agent-key.sh — run on ocmac-air
set -euo pipefail
SERVICE="purchasing_agent_api_key"
ACCOUNT="openclaw"

PLAINTEXT=$(openssl rand -hex 32)
security add-generic-password \
  -a "$ACCOUNT" -s "$SERVICE" \
  -l "OpenClaw Sam API key (POL-113)" \
  -w "$PLAINTEXT" -U

HASH=$(printf '%s' "$PLAINTEXT" | shasum -a 256 | awk '{print $1}')
unset PLAINTEXT

echo "SHA-256 hash to insert into public.agent_credentials.api_key_hash:"
echo "$HASH"
```

After this runs, insert the row in Supabase (`execute_sql` from a Claude Code
session, or the SQL editor):

```sql
INSERT INTO public.agent_credentials (agent_id, org_id, api_key_hash, label, is_active)
VALUES (
  'purchasing-agent',
  '99183187-da8e-4ce1-b28a-d08cc70cd7d4',  -- QButton
  '<hash from the script above>',
  'Sam (purchasing agent) — POL-113 initial issuance',
  true
);
```

### 3.2 Paste vendor secrets into Keychain

For each vendor secret (after rotating in the respective console — see §6):

```bash
read -s -p "Paste secret value: " VALUE; echo
security add-generic-password \
  -a "openclaw" -s "<service-name-from-§2>" \
  -l "OpenClaw <human label>" \
  -w "$VALUE" -U
unset VALUE
```

The `-s` (stdin password read) keeps the plaintext out of shell history.
Repeat for every row in §2 except `purchasing_agent_api_key` (handled in §3.1)
and `supabase_service_role` (set in the Supabase dashboard's Edge Function
secrets UI, never on ocmac-air).

### 3.3 Install the wrapper script

```bash
mkdir -p ~/.openclaw
cat > ~/.openclaw/start.sh <<'STARTEOF'
#!/usr/bin/env bash
set -euo pipefail

# Boot-time secret loader for OpenClaw on ocmac-air.
# Reads from macOS Keychain (account 'openclaw') and exec's the OpenClaw runtime.
# Fails fast if any required secret is missing — never silently degrades.

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

export TELEGRAM_BOT_TOKEN="$(fetch qbutton_telegram_bot)"
export SUPABASE_ANON_KEY="$(fetch supabase_anon_key)"
export OPENAI_API_KEY="$(fetch openai_api_key)"
export GEMINI_API_KEY="$(fetch gemini_api_key)"
export GROQ_API_KEY="$(fetch groq_api_key)"
export PURCHASING_AGENT_API_KEY="$(fetch purchasing_agent_api_key)"

# Static config (non-secret) — Tailscale IPs, project ref, etc.
export SUPABASE_URL="https://ttlyfhkrsjjrzxiagzpb.supabase.co"
export GEMMA_OLLAMA_URL="${GEMMA_OLLAMA_URL:-http://100.115.147.8:11434}"

exec openclaw start --config "$HOME/.openclaw/openclaw.json"
STARTEOF
chmod 700 ~/.openclaw/start.sh
```

### 3.4 Strip plaintext from `~/.openclaw/openclaw.json`

`openclaw.json` should hold ONLY non-secret config — env-var names, feature
flags, scheduling cron, model selection. After §3.3, edit the file so every
formerly-plaintext field references its env var by name (or is removed if the
runtime now reads directly from the environment).

Verify:

```bash
# Should print nothing — no remaining secret-shaped strings.
grep -E '(sk-|xoxb-|AIza|tg_|tgbot|tt(ly|lf|lt)|eyJ)' ~/.openclaw/openclaw.json || echo "clean"
```

### 3.5 Update launchd to use the wrapper

If OpenClaw is started by a launchd plist, point `ProgramArguments` at
`~/.openclaw/start.sh` instead of the OpenClaw binary directly. Unload + load
the plist to pick up the change.

---

## 4. Rotation procedure

Quarterly cadence (next: ~2026-08-11). Run for one service at a time so a
failed rotation can be rolled back from the keychain entry that still exists.

### 4.1 Vendor-side rotation

For `qbutton_telegram_bot`, `openai_api_key`, `gemini_api_key`, `groq_api_key`,
`supabase_anon_key`, `supabase_service_role`:

1. Open the vendor console (BotFather / OpenAI / etc).
2. Generate a NEW key. Do not revoke the OLD one yet.
3. On ocmac-air: `security add-generic-password -a openclaw -s <service> -w '<new>' -U`
4. Restart OpenClaw via launchd (or run `~/.openclaw/start.sh` manually
   first to confirm no missing-env crashes).
5. Verify Sam / Matt complete a real operation (Telegram message round-trip,
   LLM call, Supabase read).
6. Revoke the OLD key in the vendor console.

For `supabase_service_role` specifically, step 3 is "set in Supabase dashboard
Edge Function secrets" — not on ocmac-air. The service-role key never touches
ocmac-air.

### 4.2 Sam's API key (`purchasing_agent_api_key`)

Sam's credential is ours end-to-end. Rotation is bilateral with the database.

```bash
#!/usr/bin/env bash
# scripts/openclaw/rotate-purchasing-agent-key.sh — run on ocmac-air
set -euo pipefail

SERVICE="purchasing_agent_api_key"
ACCOUNT="openclaw"

NEW_PLAINTEXT=$(openssl rand -hex 32)
security add-generic-password -a "$ACCOUNT" -s "$SERVICE" \
  -l "OpenClaw Sam API key (rotated $(date -u +%Y-%m-%d))" \
  -w "$NEW_PLAINTEXT" -U

NEW_HASH=$(printf '%s' "$NEW_PLAINTEXT" | shasum -a 256 | awk '{print $1}')
unset NEW_PLAINTEXT

echo "New SHA-256 hash:"
echo "$NEW_HASH"
```

Then in Supabase, INSERT a new active row (do not UPDATE the old row — leave
its hash intact so any in-flight requests still authenticate during the
overlap window), then deactivate the old row after restart:

```sql
-- Step 1: add the new row (Sam now has two valid credentials).
INSERT INTO public.agent_credentials (agent_id, org_id, api_key_hash, label, is_active)
VALUES (
  'purchasing-agent',
  '99183187-da8e-4ce1-b28a-d08cc70cd7d4',
  '<new hash>',
  'Sam rotated 2026-MM-DD',
  true
);

-- Step 2: restart OpenClaw so Sam picks up the new key from Keychain.

-- Step 3: deactivate the old row (after confirming the new key works).
UPDATE public.agent_credentials
   SET is_active = false,
       label = label || ' (rotated out 2026-MM-DD)'
 WHERE agent_id = 'purchasing-agent'
   AND org_id = '99183187-da8e-4ce1-b28a-d08cc70cd7d4'
   AND api_key_hash = '<old hash>';
```

The two-step pattern guarantees no auth gap during the restart. After ~24 h
of successful operation on the new key, hard-delete the deactivated row if
desired:

```sql
DELETE FROM public.agent_credentials WHERE is_active = false AND updated_at < NOW() - INTERVAL '7 days';
```

---

## 5. Recovery

### 5.1 Keychain locked or wiped

If the login keychain is locked (user logged out / FileVault re-issued) or
wiped:

1. Log in as `gregorymaier` on ocmac-air (physically or via VNC; SSH can't
   unlock a locked Keychain).
2. Re-run §3.1 to issue a fresh `purchasing_agent_api_key`. Old Sam
   credential row in `agent_credentials` is now orphaned — deactivate it.
3. Re-run §3.2 for each vendor secret. Vendor keys are still valid; just
   need to be re-pasted from wherever Greg keeps the canonical copies (1Password,
   the original vendor consoles).
4. Restart OpenClaw via launchd. The boot-time check in `start.sh` will
   surface any still-missing service name with a clear error.

### 5.2 Stolen plaintext (compromise)

Treat as a full rotation of every secret listed in §2. Vendor keys via §4.1,
Sam's key via §4.2. Document the incident in [docs/operations/incidents/](incidents/)
with timestamp, scope, and rotation log.

---

## 6. Initial migration checklist (for POL-113)

Greg owns the vendor consoles; Claude owns the database side and the
documentation. Coordinate one secret at a time.

- [ ] **Telegram bot token** — regenerate via BotFather (`/revoke`, then
      `/token` for the QButton bot). Paste new value into Keychain via §3.2.
- [ ] **Supabase service-role key** — rotate in Supabase dashboard →
      Settings → API → Service Role Key. Update Edge Function secrets in
      the same UI. Do NOT add to ocmac-air Keychain.
- [ ] **Supabase anon key** — same dashboard. Paste into Keychain.
- [ ] **OpenAI API key** — rotate in OpenAI console, paste into Keychain.
- [ ] **Gemini API key** — rotate in AI Studio, paste into Keychain.
- [ ] **Groq API key** — rotate in Groq console, paste into Keychain.
- [ ] **Sam's API key** — run §3.1 script on ocmac-air, paste returned hash
      into the SQL INSERT.
- [ ] **Install wrapper** — §3.3.
- [ ] **Strip plaintext** — §3.4.
- [ ] **Update launchd** — §3.5.
- [ ] **Verify** — restart OpenClaw, watch logs for missing-env errors,
      confirm Sam + Matt complete one real operation each.

When every box is ticked, mark POL-113 Done and schedule the first quarterly
rotation reminder.

---

## 7. References

- Plan §7.2 (`docs/projects/purchasing-agent-implementation-plan.md` line 1505)
- Stage-3 launch gate: plan §6.7 #8
- Existing pattern: `supabase/functions/agent-send-flyer/index.ts` (already
  uses `agent_credentials` + Edge Function service-role isolation)
- Related: POL-115 (`agent-closure-rpc` Edge Function — the consumer of Sam's
  `purchasing_agent_api_key`)
