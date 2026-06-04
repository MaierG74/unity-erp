# OpenClaw operational scripts

These scripts run on **`ocmac-air`**, not in the Unity ERP dev environment.
They're version-controlled here because Unity ERP owns the canonical
secrets-management story (POL-113) — Sam's `agent_credentials` row is in
the same Supabase project Unity ERP uses, and the wrapper script loads the
keys Sam uses to call Unity ERP's Edge Functions.

Deploy to ocmac-air with:

```bash
scp scripts/openclaw/*.sh gregorymaier@ocmac-air.tail410dd9.ts.net:~/.openclaw/scripts/
```

| Script | Purpose | When to run |
| --- | --- | --- |
| `start.sh` | Loads every secret from Keychain into env vars, then exec's OpenClaw | Every OpenClaw boot (via launchd) |
| `issue-purchasing-agent-key.sh` | One-shot bootstrap of Sam's API key | Once, during POL-113 initial migration |
| `rotate-purchasing-agent-key.sh` | Replace Sam's API key with a new value | Quarterly, or on compromise |

For full context, vendor rotation procedures, and the recovery runbook,
see [`docs/operations/openclaw-secrets-runbook.md`](../../docs/operations/openclaw-secrets-runbook.md).
