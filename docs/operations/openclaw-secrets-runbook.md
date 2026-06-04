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

### 3.2 Bulk-move existing vendor secrets into Keychain

The canonical migration uses
[`scripts/openclaw/migrate-secrets-to-keychain.sh`](../../scripts/openclaw/migrate-secrets-to-keychain.sh).
Idempotent: skips entries already in Keychain. Uses `-A` so launchd /
SSH-spawned reads at boot don't prompt. Backs up `openclaw.json` before
any changes. Prints only service names, never values.

```bash
~/.openclaw/scripts/migrate-secrets-to-keychain.sh
```

The script handles these services (skipping any whose JSON pointer is
absent in the current `openclaw.json`):

| Service name              | Source in openclaw.json            |
| ------------------------- | ---------------------------------- |
| `qbutton_telegram_bot`    | `.channels.telegram.botToken`      |
| `gateway_auth_token`      | `.gateway.auth.token`              |
| `groq_api_key`            | `.env.GROQ_API_KEY`                |
| `agent_flyer_api_key`     | `.env.AGENT_FLYER_API_KEY`         |
| `openai_api_key`          | `.env.OPENAI_API_KEY` (optional)   |
| `gemini_api_key`          | `.env.GEMINI_API_KEY` (optional)   |
| `supabase_anon_key`       | `.env.SUPABASE_ANON_KEY` (optional)|

**Supabase service-role key** stays out of Keychain entirely — it belongs
in Supabase dashboard → Edge Functions → Secrets, accessible only to the
Edge Functions that need it. The migration script does NOT touch it.

If you need to add a one-off secret not covered by the script, the manual
form is:

```bash
read -s -p "Paste secret value: " VALUE; echo
security add-generic-password \
  -a "openclaw" -s "<service-name>" \
  -l "<human label>" \
  -w "$VALUE" -A
unset VALUE
```

The `-A` flag (allow all apps) is required so wrapper boot doesn't prompt.
The `-s` on `read` keeps plaintext out of shell history.

#### 3.2.1 ACL fix for entries created without `-A`

If an entry was added without `-A` (early versions of the issue script,
or hand-typed `add-generic-password` without the flag), launchd / SSH
reads will block on "User interaction is not allowed." Fix without losing
the plaintext:

```bash
# Will prompt once via GUI for keychain access.
security set-generic-password-partition-list \
  -S 'apple-tool:,apple:,unsigned:' \
  -a openclaw -s '<service-name>' \
  -k "$(read -s -p 'Login password: ' P; echo $P)"
```

Or: open Keychain Access GUI, find the entry, Get Info → Access Control
→ "Allow all applications to access this item" → Save Changes.

### 3.3 Install the wrapper script

[`scripts/openclaw/start.sh`](../../scripts/openclaw/start.sh) is the
canonical wrapper. It separates **required** secrets (fail boot fast if
missing) from **optional** secrets (set if present, silently skip if not).

Install:

```bash
cp ~/.openclaw/scripts/start.sh ~/.openclaw/start.sh
chmod 700 ~/.openclaw/start.sh
```

Test before wiring into launchd:

```bash
# Should print the OpenClaw banner / start logs without any FATAL.
~/.openclaw/start.sh
# (Ctrl-C after a few seconds; we're just verifying env loading works.)
```

If a `FATAL: Keychain entry missing for service '...'` fires, run §3.2
for the missing service.

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

## 6. Migration checklist — phased

The POL-113 work splits into two phases. **Internal-dev phase (now, ~2026-05-11
through QButton handoff)** is structural cleanup that buys most of the
security benefit without console-and-rotate friction. **Pre-handoff phase**
fires when Greg decides Sam ships to QButton; it invalidates every key that
ever touched the disk, on the assumption that anything plaintext-on-disk
is potentially compromised.

The plan §7.2 originally treated rotation as part of POL-113. In practice
the rotation only matters for the QButton threat model — for internal dev
against Greg's own org on Greg's own M1 Air, with no evidence of leak, the
move-into-Keychain step alone removes the practical attack surface.

### 6.1 Internal-dev phase (POL-113 scope, now)

Greg owns the ocmac-air operations; Claude owns the database side and the
documentation.

- [ ] **Sam's API key — issue** — run §3.1 script on ocmac-air, paste
      returned hash into the SQL INSERT. (Initial issuance, not rotation —
      Sam has no prior credential.)
- [ ] **Move existing vendor secrets into Keychain (no rotation)** —
      for each service in §2 except `supabase_service_role`, copy the
      CURRENT plaintext value out of `~/.openclaw/openclaw.json` and paste
      it into Keychain via the §3.2 `read -s` pattern. Keep the value
      the same; just relocate.
- [ ] **Supabase service-role key — relocate to Edge Function secrets**
      (not Keychain). Set in Supabase dashboard → Edge Functions →
      Secrets. OpenClaw on ocmac-air must NEVER hold the service-role
      key — only the agent API key.
- [ ] **Install wrapper** — §3.3.
- [ ] **Strip plaintext from `openclaw.json`** — §3.4. The plaintext
      values now live ONLY in Keychain (and in the vendor consoles where
      they were originally generated).
- [ ] **Update launchd** — §3.5.
- [ ] **Verify** — restart OpenClaw, watch logs for missing-env errors,
      confirm Sam + Matt complete one real operation each.

When every box above is ticked, mark POL-113 Done.

### 6.2 Pre-handoff phase (separate ticket, fires at QButton handoff prep)

Rotate every vendor secret that ever sat plaintext on ocmac-air. The
threat model expands from "Greg's personal Mac" to "Greg's Mac plus
whatever QButton's environment introduces" — anything that was on disk
is presumed compromised.

- [ ] **Telegram bot token** — regenerate via BotFather (`/revoke`, then
      `/token` for the QButton bot). Update Keychain via §3.2.
- [ ] **Supabase service-role key** — rotate in Supabase dashboard. Update
      Edge Function secrets.
- [ ] **Supabase anon key** — same dashboard. Update Keychain.
- [ ] **OpenAI API key** — rotate in OpenAI console, update Keychain.
- [ ] **Gemini API key** — rotate in AI Studio, update Keychain.
- [ ] **Groq API key** — rotate in Groq console, update Keychain.
- [ ] **Sam's API key** — rotate via §4.2 two-step pattern.
- [ ] **Verify old keys are denied** — try each old value against its
      respective service; expect 401/403. Document the timestamp of
      successful denial.

File the pre-handoff ticket when Greg's ~2026-05-18 ship/extend decision
goes "ship to QButton." Until then, the rotations are out of scope.

---

## 7. References

- Plan §7.2 (`docs/projects/purchasing-agent-implementation-plan.md` line 1505)
- Stage-3 launch gate: plan §6.7 #8
- Existing pattern: `supabase/functions/agent-send-flyer/index.ts` (already
  uses `agent_credentials` + Edge Function service-role isolation)
- Related: POL-115 (`agent-closure-rpc` Edge Function — the consumer of Sam's
  `purchasing_agent_api_key`)
