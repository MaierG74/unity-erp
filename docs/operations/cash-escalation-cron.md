# Cash Escalation Cron

Run the cash-supplier escalation chain from the OpenClaw runtime every 30 minutes. The agent credential determines the organization; do not pass `p_org_id` from cron because `agent-closure-rpc` injects it from the bearer credential.

## Environment

```bash
UNITY_SUPABASE_URL="https://ttlyfhkrsjjrzxiagzpb.supabase.co"
UNITY_AGENT_CREDENTIAL="<agent credential secret>"
```

## 30-Minute Sequence

```bash
curl -fsS "$UNITY_SUPABASE_URL/functions/v1/agent-closure-rpc" \
  -H "Authorization: Bearer $UNITY_AGENT_CREDENTIAL" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "detect_cash_po_exceptions",
    "capability": "finance",
    "params": {},
    "idempotency_key": "cash-detect-'"$(date -u +%Y%m%d%H%M)"'",
    "summary": "Detect cash supplier payment lifecycle exceptions"
  }'
```

```bash
curl -fsS "$UNITY_SUPABASE_URL/functions/v1/agent-closure-rpc" \
  -H "Authorization: Bearer $UNITY_AGENT_CREDENTIAL" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "escalate_due_closure_items",
    "capability": "finance",
    "params": {},
    "idempotency_key": "cash-escalate-'"$(date -u +%Y%m%d%H%M)"'",
    "summary": "Escalate due cash supplier closure items"
  }'
```

```bash
curl -fsS "$UNITY_SUPABASE_URL/functions/v1/process-payment-escalations" \
  -H "Authorization: Bearer $UNITY_AGENT_CREDENTIAL" \
  -H "Content-Type: application/json" \
  -X POST
```

## Crontab

Install on the OpenClaw mac after exporting `UNITY_SUPABASE_URL` and `UNITY_AGENT_CREDENTIAL` in the cron environment or loading them from the runtime secrets file.

```cron
*/30 * * * * /bin/zsh -lc 'curl -fsS "$UNITY_SUPABASE_URL/functions/v1/agent-closure-rpc" -H "Authorization: Bearer $UNITY_AGENT_CREDENTIAL" -H "Content-Type: application/json" -d "{\"method\":\"detect_cash_po_exceptions\",\"capability\":\"finance\",\"params\":{},\"idempotency_key\":\"cash-detect-$(date -u +\%Y\%m\%d\%H\%M)\",\"summary\":\"Detect cash supplier payment lifecycle exceptions\"}" && curl -fsS "$UNITY_SUPABASE_URL/functions/v1/agent-closure-rpc" -H "Authorization: Bearer $UNITY_AGENT_CREDENTIAL" -H "Content-Type: application/json" -d "{\"method\":\"escalate_due_closure_items\",\"capability\":\"finance\",\"params\":{},\"idempotency_key\":\"cash-escalate-$(date -u +\%Y\%m\%d\%H\%M)\",\"summary\":\"Escalate due cash supplier closure items\"}" && curl -fsS "$UNITY_SUPABASE_URL/functions/v1/process-payment-escalations" -H "Authorization: Bearer $UNITY_AGENT_CREDENTIAL" -H "Content-Type: application/json" -X POST'
```
