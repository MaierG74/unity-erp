# Purchasing Agent — 30-Day Engineering Plan

**Source:** GPT-5.5 Deep Research, 2026-05-08
**Inputs:** the brief at `docs/projects/purchasing-agent-aims.md` (PR #86, may not have been merged at time of research — note GPT's 404 caveat below), plus pamphlet/advert source decks, OpenClaw architecture, existing purchasing/inventory schema, the flyer-agent Edge Function pattern, and Linear pilot issues POL-100 through POL-104.
**Status:** Reference plan. To be decomposed into Linear issues. Open decisions are listed in the companion review note (this conversation, message of 2026-05-08).
**Companion:** `docs/projects/purchasing-agent-aims.md` (the contract we sold).

> The report below is preserved verbatim from the GPT-5.5 Deep Research run on 2026-05-08. Internal notes and pushback are tracked in conversation, not edited into the report itself, so the source remains a clean reference.

---

## Source note and assumptions

This plan is grounded in the uploaded brief, the OpenClaw architecture doc, the Purchasing Agent pamphlet/source deck, the nervous-system positioning doc, existing purchasing/inventory schema, the flyer-agent Edge Function pattern, and the Linear pilot issues POL-100 through POL-104.

One source path in the brief, `docs/projects/purchasing-agent-aims.md`, returned 404 on both `codex/integration` and `main`. I therefore treated the sold Purchasing Agent capabilities as the five-stage purchasing-cycle story from `docs/pitch/nervous-system-pamphlet.marp.md`, plus the Linear pilot issues. The pamphlet explicitly sells daily order-shortfall scanning, overdue PO risk detection, delivery-note matching, inventory drift/stock-count watching, and Telegram-first photo/voice/status interaction.

The core recommendation is: **ship a constrained, production-safe Purchasing Agent in 30 days by building POL-100 first, running on the existing OpenClaw M1 host, writing only closure/audit/proposal metadata automatically, and requiring human approval for every operational write.**

---

# 1. Architecture

## 1.1 Runtime fit

The Purchasing Agent should **extend the existing OpenClaw runtime on `ocmac-air`**. Do not fork OpenClaw and do not rewrite Matt. The repo's architecture already defines OpenClaw as the dedicated M1-hosted autonomous runtime, Telegram-first, sharing Supabase with Unity ERP, with Matt as the human-facing coordinator and specialist agents planned for receiving and purchasing.

For QButton v1, run this as:

| Layer                     | Concrete implementation                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime host              | Existing M1 MacBook Air, `ocmac-air`                                                                                               |
| OpenClaw agent            | Keep `Matt` as orchestrator; add a `purchasing` domain worker/skill under the same OpenClaw install                                |
| Bot topology              | Start with one QButton-facing Purchasing Agent Telegram bot or Matt-routed purchasing thread; keep separate credentials internally |
| Data read path            | Supabase MCP using an org-scoped read-only agent identity                                                                          |
| Data write path           | Supabase Edge Functions authenticated through `agent_credentials`                                                                  |
| Business write rule       | No PO creation, stock receipt, stock adjustment, supplier email, or order mutation without human approval                          |
| Allowed autonomous writes | `closure_items`, `closure_item_activity`, `agent_action_log`, `agent_watched_items`, and message-outbox records only               |

This preserves the "spine + nervous system" product story: Unity remains the system of record, while OpenClaw watches, notices, escalates, and drives closure. The positioning doc is clear that the closure engine, not prompt cleverness, is the load-bearing product feature.

## 1.2 Process model: hybrid, not pure cron

Use a **hybrid model**:

| Trigger type                 | Used for                                                                                      | Why                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- |
| Event-driven Telegram intake | Delivery-note photos, stock-count photos, buyer voice notes, approvals, close/snooze commands | Human work arrives unpredictably        |
| Cron-driven DB sweeps        | Daily shortfall scan, overdue PO scan, closure aging, daily brief                             | These are watch loops over ERP state    |
| Edge Function callbacks      | Approved writes, action logging, idempotent proposal execution                                | Keeps service-role key away from agent  |
| Startup reconciliation       | After crash/reboot, re-scan active watched items and closure queue                            | Agent memory is not the source of truth |

Recommended schedules, local QButton time:

```text
05:30 Mon-Sat  purchasing-demand-scan        # open orders vs BOM/stock/open POs
06:00 Mon-Sat  purchasing-overdue-po-scan    # late POs and supplier-order risk
06:15 Mon-Sat  closure-aging-scan            # SLA/escalation eligibility
07:05 Mon-Sat  qbutton-daily-brief           # one stable brief, only if actionable
*/15 06-17 * * Mon-Fri closure-aging-scan    # business-hour escalation only
*/30 06-17 * * Mon-Fri po-risk-refresh       # due-today / due-late refresh
16:00 Mon-Fri  supplier-followup-summary     # unresolved supplier-chase items
```

Telegram events should be processed immediately during business hours. Outside business hours, only create/update closure items unless the policy explicitly marks something as urgent.

## 1.3 LLM routing

Use deterministic SQL and rules wherever possible. The LLM should explain, classify, match ambiguous text, and draft concise messages — not be the primary accounting engine.

| Task                                             | Model                                | Notes                                                                            |
| ------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- |
| Hard reasoning over ambiguous purchasing context | GPT-5.5 reasoning                    | Use for PO impact analysis, ambiguous OCR matching, duplicate/edge-case triage   |
| Vision/OCR                                       | Gemini 3 Flash                       | Delivery notes, handwritten stock counts, labels, count sheets                   |
| Cheap classification and formatting              | GPT-5.4-mini                         | Intent classification, message formatting, dedupe summaries, daily brief wording |
| Voice transcription                              | Groq Whisper path already documented | Telegram voice notes become text before agent reasoning                          |
| Future local model                               | Local Gemma                          | Only for low-risk classification and heartbeat pre-filtering after validation    |

The current architecture doc already recommends multi-model routing and warns that large Supabase results are the main token/cost risk; keep queries narrow and pass compact JSON summaries to the model.

## 1.4 Physical runtime decision

Stay on `ocmac-air` for the 30-day QButton trial.

Reasons:

1. It already hosts Matt and Telegram/OpenClaw integration.
2. Expected QButton volume is low enough for a single M1.
3. Supabase, not the Mac, is the data source of truth.
4. Moving infrastructure now adds risk without improving the customer outcome.

Hardening is mandatory before live customer data flows. The existing Linear operations backlog already calls out auto-restart and observability for the M1 host.

## 1.5 Failure modes and recovery

| Failure                     | Early signal                                        | Recovery design                                                                     |
| --------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| OpenClaw process crash      | No heartbeat row updated for >10 minutes            | `launchd` or `pm2` restart; admin Telegram alert; startup reconciliation            |
| Mac offline                 | Tailscale unreachable, no agent heartbeat           | Human operations continue in Unity; restore agent on spare Mac/server from runbook  |
| LLM/API outage              | Model timeout/error rate >20% in last hour          | Fall back to deterministic SQL scan; defer non-urgent messages; log degraded mode   |
| OCR false positive          | Human corrections spike; confidence below threshold | Never auto-receive; require approval and show extracted lines before action         |
| Duplicate closure spam      | Same source appears repeatedly                      | `agent_watched_items.source_fingerprint` + unique active closure index              |
| Edge Function write failure | Approved action returns non-2xx                     | Keep pending action open; post one concise failure to responsible human             |
| Tenant leak risk            | Query without `org_id`, RLS advisor warning         | Block deployment; agent credential derives `org_id`; no caller-supplied org trusted |
| Telegram send failure       | Outbox message not delivered                        | Retry with exponential backoff; do not re-evaluate item as "new"                    |

---

# 2. Data layer

## 2.1 Existing schemas to read

The current schema and types show a workable purchasing/inventory base: orders, order details, BOM, components, inventory, inventory transactions, suppliers, supplier components, purchase orders, supplier orders, supplier receipts, drafts, component reservations, and work-pool exceptions.

| Domain                | Existing tables/functions                                                               | Purchasing Agent use                                   |
| --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Tenant scope          | `organizations`, `organization_members`, `is_org_member()`                              | Every read/write must be QButton `org_id`-locked       |
| Customer demand       | `orders`, `order_details`, `order_statuses`, `customers`                                | Identify open orders, due dates, customer impact       |
| Product structure     | `products`, `billofmaterials`, `billoflabour`, `job_work_pool`                          | BOM demand and production dependency impact            |
| Components            | `components`, `component_categories`, `unitsofmeasure`                                  | Match delivery-note lines and stock counts             |
| Stock                 | `inventory`, `inventory_transactions`, `component_status_mv`                            | On-hand, stock movements, variance investigation       |
| Reservations          | `component_reservations`, `get_detailed_component_status(order_id)`                     | Reservation-aware shortfall checks                     |
| Purchasing master     | `suppliers`, `supplier_emails`, `suppliercomponents`                                    | Supplier choice, supplier codes, price, lead time, MOQ |
| POs                   | `purchase_orders`, `supplier_orders`, `supplier_order_statuses`                         | PO status, expected delivery, overdue tracking         |
| Receipts              | `supplier_order_receipts`, `process_supplier_order_receipt(...)`                        | Human-approved receiving workflow                      |
| PO drafts             | `purchase_order_drafts`, `purchase_order_draft_lines`, `save_purchase_order_draft(...)` | Safe AI-created drafts before buyer approval           |
| PO allocation         | `supplier_order_customer_orders`                                                        | Link PO lines to customer orders and stock allocations |
| Balance closures      | `supplier_order_balance_closures`, `close_supplier_order_balance(...)`                  | Resolve short/partial delivery balances with audit     |
| Stock issue           | `stock_issuances`, `process_stock_issuance(...)`, reversals                             | Trace stock disappearance and job/order consumption    |
| Production exceptions | `job_work_pool_exceptions`, `job_work_pool_exception_activity`                          | Migration seed for general closure engine              |

The PO draft migration is especially useful because it already provides a safe place for incomplete purchasing work without polluting live purchase orders.

## 2.2 New schemas needed outside POL-100

POL-100 gets the closure-engine DDL in section 3. The additional agent support tables should be:

### `agent_action_log`

Append-only operational audit for every meaningful agent step.

```sql
create table if not exists public.agent_action_log (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  agent_id            text not null,
  run_id              uuid not null default gen_random_uuid(),
  capability          text not null,
  action_kind          text not null
    check (action_kind in (
      'read',
      'reason',
      'proposal',
      'message',
      'approved_write',
      'rejected_write',
      'error',
      'dry_run'
    )),
  target_type         text,
  target_id           text,
  closure_item_id     uuid,
  model               text,
  input_tokens        integer,
  output_tokens       integer,
  idempotency_key     text,
  request_summary     text,
  request_payload     jsonb not null default '{}'::jsonb,
  result_status       text not null default 'ok'
    check (result_status in ('ok', 'skipped', 'failed', 'blocked')),
  result_summary      text,
  result_payload      jsonb not null default '{}'::jsonb,
  approved_by         uuid references auth.users(id),
  error_message       text,
  created_at          timestamptz not null default timezone('utc', now())
);

create index if not exists agent_action_log_org_created_idx
  on public.agent_action_log(org_id, created_at desc);
create index if not exists agent_action_log_run_idx
  on public.agent_action_log(run_id);
create unique index if not exists agent_action_log_idempotency_unique
  on public.agent_action_log(org_id, idempotency_key)
  where idempotency_key is not null;
```

### `agent_watched_items`

Deduplication and "considered messaging" state.

```sql
create table if not exists public.agent_watched_items (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id),
  agent_id              text not null,
  capability            text not null,
  source_type           text not null,
  source_id             text not null,
  source_fingerprint    text not null,
  last_payload_hash     text,
  closure_item_id       uuid,
  first_seen_at         timestamptz not null default timezone('utc', now()),
  last_seen_at          timestamptz not null default timezone('utc', now()),
  last_evaluated_at     timestamptz,
  next_evaluate_at      timestamptz,
  last_notified_at      timestamptz,
  last_notification_key text,
  silence_until         timestamptz,
  state                 text not null default 'watching'
    check (state in ('watching', 'linked_to_closure', 'ignored', 'closed')),
  metadata              jsonb not null default '{}'::jsonb
);

create unique index if not exists agent_watched_items_unique_source
  on public.agent_watched_items(org_id, agent_id, source_type, source_fingerprint);
create index if not exists agent_watched_items_due_idx
  on public.agent_watched_items(org_id, next_evaluate_at)
  where state in ('watching', 'linked_to_closure');
```

### `agent_org_config`

Feature flags by org and capability.

```sql
create table if not exists public.agent_org_config (
  org_id              uuid not null references public.organizations(id),
  agent_id            text not null,
  capability          text not null,
  mode                text not null default 'off'
    check (mode in ('off', 'shadow', 'dry_run', 'closure_only', 'proposal_writes', 'live_approved_writes')),
  telegram_chat_id    text,
  daily_brief_time    time not null default '07:05',
  timezone            text not null default 'Africa/Johannesburg',
  config              jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default timezone('utc', now()),
  primary key (org_id, agent_id, capability)
);
```

### `telegram_user_bindings`

Needed for per-user threads and approval identity.

```sql
create table if not exists public.telegram_user_bindings (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  user_id             uuid references auth.users(id),
  telegram_user_id    text not null,
  telegram_chat_id    text not null,
  display_name        text,
  role                text not null default 'operator',
  allowed_actions     text[] not null default array[]::text[],
  is_active           boolean not null default true,
  created_at          timestamptz not null default timezone('utc', now()),
  unique (org_id, telegram_user_id)
);
```

## 2.3 RLS strategy

All new tables need RLS enabled. The default policy should be:

```sql
alter table public.agent_action_log enable row level security;
alter table public.agent_watched_items enable row level security;
alter table public.agent_org_config enable row level security;
alter table public.telegram_user_bindings enable row level security;

create policy agent_action_log_select_org_member
on public.agent_action_log
for select to authenticated
using (public.is_org_member(org_id));

create policy agent_watched_items_select_org_member
on public.agent_watched_items
for select to authenticated
using (public.is_org_member(org_id));

create policy agent_org_config_select_org_member
on public.agent_org_config
for select to authenticated
using (public.is_org_member(org_id));

create policy telegram_user_bindings_select_org_member
on public.telegram_user_bindings
for select to authenticated
using (public.is_org_member(org_id));
```

For v1, do **not** grant normal users broad insert/update/delete on these agent tables. Writes should go through RPCs/Edge Functions so the audit model stays clean.

## 2.4 Agent identity

Create one QButton-scoped agent identity:

```text
agent_id: purchasing-agent
label: Purchasing Agent — QButton trial
org: QButton org_id
```

Use two identities:

1. **Read identity**: `agent_worker` / `agent_user` with SELECT-only access and QButton org membership.
2. **Write credential**: `agent_credentials` API key used only by Supabase Edge Functions.

The existing `agent_credentials` migration already stores hashed per-agent API keys bound to `org_id`, and the flyer Edge Function already demonstrates deriving tenant context from that credential instead of trusting caller-provided org data.

## 2.5 Read pattern vs write pattern

### Reads

Read through Supabase MCP or typed read functions using the read-only agent identity:

```text
agent -> Supabase MCP -> SELECT from approved views/tables -> compact JSON -> reasoning/model
```

Rules:

* Always include `org_id` filters.
* Prefer views/RPCs that return compact summaries.
* Never dump entire schemas or large table scans into LLM context.
* Log read summaries to `agent_action_log`, not raw sensitive rows.

### Writes

All writes go through Edge Functions:

```text
agent -> Edge Function -> authenticate agent_credentials -> derive org_id -> validate payload -> write with service_role -> log result
```

Recommended Edge Functions:

| Function                        | Purpose                                               |
| ------------------------------- | ----------------------------------------------------- |
| `agent-register-closure-item`   | Create/update closure item and activity               |
| `agent-log-observation`         | Append observation without changing business state    |
| `agent-create-po-draft`         | Save AI-generated PO draft lines for buyer review     |
| `agent-propose-receipt`         | Store delivery-note OCR result and receipt proposal   |
| `agent-execute-approved-action` | Execute an approved PO/receipt/close action           |
| `agent-telegram-action`         | Resolve Telegram callback buttons to approved actions |
| `agent-record-stock-count`      | Record human-submitted count and open variance item   |

The agent never calls `create_purchase_order_with_lines`, `process_supplier_order_receipt`, `close_supplier_order_balance`, or `process_stock_issuance` directly. Those calls happen only after a human approval event.

---

# 3. Closure engine — POL-100

POL-100 is the critical path. Linear defines it as the reusable owner/age/SLA/escalation primitive that generalises `job_work_pool_exceptions` and blocks the pilot agents.

## 3.1 Recommendation: new table alongside existing exceptions

Do **not** column-extend `job_work_pool_exceptions` into a universal table. Keep it working for manufacturing, and create a new general primitive:

* `closure_items`
* `closure_item_activity`
* `closure_item_sla_pauses`
* `closure_escalation_events`

Why:

* Existing `job_work_pool_exceptions` is tightly coupled to work-pool rows, order IDs, exception types, and production-specific resolution types.
* The current exception pattern is valuable: unique open exception, append-only activity, RPC lifecycle transitions, and org-aware RLS. Keep that shape, not the table.
* Purchasing items need different source types: PO line, supplier order, OCR line, stock variance, missing master data, draft approval, supplier chase.

## 3.2 Core DDL

```sql
create table if not exists public.closure_items (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id),
  source_type           text not null,
  source_id             text not null,
  source_fingerprint    text not null,
  capability            text not null,
  item_type             text not null,
  title                 text not null,
  summary               text,
  status                text not null default 'open'
    check (status in (
      'open',
      'in_progress',
      'waiting_external',
      'blocked',
      'paused',
      'closed',
      'cancelled'
    )),
  severity              text not null default 'medium'
    check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  owner_user_id         uuid references auth.users(id),
  owner_agent_id        text,
  owner_role            text,
  opened_by_user_id     uuid references auth.users(id),
  opened_by_agent_id    text,
  opened_at             timestamptz not null default timezone('utc', now()),
  first_seen_at         timestamptz not null default timezone('utc', now()),
  last_observed_at      timestamptz not null default timezone('utc', now()),
  sla_minutes           integer not null default 480 check (sla_minutes > 0),
  due_at                timestamptz,
  total_paused_seconds  integer not null default 0 check (total_paused_seconds >= 0),
  paused_at             timestamptz,
  pause_reason_code     text,
  escalation_level      integer not null default 0 check (escalation_level >= 0),
  next_escalation_at    timestamptz,
  escalation_policy     jsonb not null default '{}'::jsonb,
  last_notified_at      timestamptz,
  last_notification_key text,
  next_notifiable_at    timestamptz,
  closure_note          text,
  closed_by_user_id     uuid references auth.users(id),
  closed_by_agent_id    text,
  closed_at             timestamptz,
  payload               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default timezone('utc', now()),
  updated_at            timestamptz not null default timezone('utc', now())
);

create unique index if not exists closure_items_active_unique_source
  on public.closure_items(org_id, source_type, source_fingerprint)
  where status not in ('closed', 'cancelled');

create index if not exists closure_items_queue_idx
  on public.closure_items(org_id, status, severity, due_at);
create index if not exists closure_items_owner_idx
  on public.closure_items(org_id, owner_user_id, status);
create index if not exists closure_items_payload_gin_idx
  on public.closure_items using gin(payload);
```

```sql
create table if not exists public.closure_item_activity (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  closure_item_id   uuid not null references public.closure_items(id) on delete cascade,
  event_type        text not null
    check (event_type in (
      'created',
      'observation_updated',
      'status_changed',
      'owner_assigned',
      'sla_paused',
      'sla_resumed',
      'escalated',
      'message_sent',
      'proposal_created',
      'human_approved',
      'human_rejected',
      'approved_action_executed',
      'duplicate_suppressed',
      'closed',
      'cancelled',
      'error'
    )),
  performed_by_user_id  uuid references auth.users(id),
  performed_by_agent_id text,
  notes             text,
  payload           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default timezone('utc', now())
);

create index if not exists closure_item_activity_item_idx
  on public.closure_item_activity(closure_item_id, created_at desc);
```

```sql
create table if not exists public.closure_item_sla_pauses (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id),
  closure_item_id        uuid not null references public.closure_items(id) on delete cascade,
  pause_started_at       timestamptz not null default timezone('utc', now()),
  pause_ended_at         timestamptz,
  reason_code            text not null,
  notes                  text,
  paused_by_user_id      uuid references auth.users(id),
  paused_by_agent_id     text,
  resumed_by_user_id     uuid references auth.users(id),
  resumed_by_agent_id    text
);

create index if not exists closure_item_sla_pauses_open_idx
  on public.closure_item_sla_pauses(org_id, closure_item_id)
  where pause_ended_at is null;
```

```sql
create table if not exists public.closure_escalation_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  closure_item_id      uuid not null references public.closure_items(id) on delete cascade,
  escalation_level     integer not null,
  target_type          text not null check (target_type in ('owner', 'supervisor', 'daily_brief', 'weekly_digest')),
  target_user_id       uuid references auth.users(id),
  target_role          text,
  message_key          text,
  fired_at             timestamptz not null default timezone('utc', now()),
  payload              jsonb not null default '{}'::jsonb
);
```

## 3.3 Computed queue view

Age should be computed, not trusted as stored data.

```sql
create or replace view public.closure_items_queue as
select
  ci.*,
  floor(
    extract(epoch from (
      coalesce(ci.closed_at, timezone('utc', now()))
      - ci.opened_at
      - (ci.total_paused_seconds * interval '1 second')
    )) / 60
  )::integer as age_minutes,
  case
    when ci.due_at is null then null
    else floor(extract(epoch from (ci.due_at - timezone('utc', now()))) / 60)::integer
  end as minutes_until_due,
  case
    when ci.due_at is not null and timezone('utc', now()) > ci.due_at then true
    else false
  end as sla_breached
from public.closure_items ci;
```

## 3.4 API surface

Implement as SQL RPCs wrapped by Edge Functions.

| API                                          | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `register_closure_item(...)`                 | Idempotent create/update by `source_fingerprint`         |
| `record_closure_observation(...)`            | Update last observed state and append activity           |
| `assign_closure_item(...)`                   | Change owner and append activity                         |
| `set_closure_status(...)`                    | Move open/in-progress/waiting/blocked                    |
| `pause_closure_sla(...)`                     | Pause clock with reason                                  |
| `resume_closure_sla(...)`                    | Resume clock and accumulate pause seconds                |
| `close_closure_item(...)`                    | Require closure note, set closed status, append activity |
| `escalate_due_closure_items(p_org_id)`       | Called by cron/agent to compute earned escalations       |
| `get_daily_closure_brief(p_org_id, p_since)` | Stable summary for Telegram brief                        |

## 3.5 Pausable SLA clocks

Support pausable SLA clocks in the primitive. This is not a phase-2 nice-to-have.

Purchasing needs pauses for:

* Waiting for supplier reply.
* Buyer explicitly snoozes while supplier is closed.
* Awaiting delivery after supplier confirms ETA.
* Awaiting manager approval on draft PO.
* Waiting for physical recount.

A pause must always have:

```text
reason_code
pause_started_at
who/what paused it
resume condition or notes
```

Do not let a paused item disappear. Paused items should stay out of urgent nudges but still appear in daily/weekly summary if old.

## 3.6 Escalation policy: hybrid JSONB + structured columns

Use structured columns for what must be indexed:

```text
sla_minutes
due_at
escalation_level
next_escalation_at
owner_user_id
owner_role
severity
status
```

Use JSONB for policy flexibility:

```json
{
  "quiet_hours": { "start": "17:00", "end": "06:00" },
  "steps": [
    { "after_minutes": 0, "target": "owner", "channel": "telegram_dm" },
    { "after_minutes": 240, "target": "supervisor", "channel": "telegram_dm" },
    { "after_minutes": 1440, "target": "daily_brief", "channel": "telegram_brief" },
    { "after_minutes": 4320, "target": "weekly_digest", "channel": "telegram_digest" }
  ],
  "repeat_policy": "only_on_level_change",
  "business_hours_only": true
}
```

This keeps the schema queryable while allowing per-capability policies.

## 3.7 Migration from existing work-pool exceptions

Use a bridge migration, not a hard cutover.

1. Create closure tables and RPCs.
2. Backfill active `job_work_pool_exceptions` into `closure_items` with:
   * `source_type = 'job_work_pool_exception'`
   * `source_id = exception_id::text`
   * `source_fingerprint = 'job_work_pool_exception:' || exception_id`
   * payload containing variance snapshots.
3. Create trigger from `job_work_pool_exception_activity` to append `closure_item_activity`.
4. New agent workflows write directly to `closure_items`.
5. Existing manufacturing UI keeps reading existing exception tables.
6. Phase 2 dashboard reads `closure_items_queue`.

The existing work-pool exception migrations already show the exact pattern to preserve: unique active exception, audit trail, org-scoped RLS, and RPC transitions.

---

# 4. Per-capability implementation

The five v1 Purchasing Agent capabilities are:

1. Customer-order material shortfall scan.
2. PO draft / supplier selection proposal.
3. Late PO and supplier follow-up tracking.
4. Delivery-note OCR and PO receipt matching.
5. Stock count / inventory drift watcher.

The Daily Brief is covered in section 5 because it is the Telegram surface over the closure engine.

---

## 4.1 Capability 1 — Customer-order material shortfall scan

### Data inputs

Read:

* `orders`, `order_details`, `order_statuses`
* `products`
* `billofmaterials`
* `components`
* `inventory`
* `component_reservations`
* `supplier_orders`, `purchase_orders`, `supplier_order_customer_orders`
* `suppliercomponents`
* `purchase_order_drafts`, `purchase_order_draft_lines`

Use `get_detailed_component_status(order_id)` where possible because it already accounts for reservations by other orders.

### Reasoning loop

Trigger:

```text
05:30 Mon-Sat
/manual command: /scan order <order_number>
after order enters production/planning status, if event available
```

Process:

1. Select open, non-cancelled customer orders with delivery dates inside the next configurable window, default 14 days.
2. Expand BOM demand by order line quantity.
3. Calculate:
   * required for this order
   * on hand
   * reserved by this order
   * reserved by other orders
   * open PO quantity allocated to this order
   * open PO quantity for stock
   * expected arrival from lead time / PO date
4. Create or update one `closure_item` per order-component shortfall.
5. Group possible PO draft lines by supplier.
6. Do not message unless at least one item needs buyer action today.

### Output

Closure item:

```text
source_type: customer_order_component_shortfall
source_id: <order_id>:<component_id>
capability: demand_shortfall_scan
item_type: po_needed
title: "Order QB-1234 short 6 x Natural Oak 22mm"
owner_role: purchasing
sla_minutes: 240
payload: {
  order_id,
  order_number,
  component_id,
  required_qty,
  available_qty,
  reserved_by_others,
  open_po_qty,
  due_date,
  recommended_supplier_component_id
}
```

Telegram, batched:

```text
🟠 Purchasing — POs needed today

3 customer orders are short for next week.

1. QB-1234 — short 6 x Natural Oak 22mm
   Needed by: Fri 15 May
   Suggested supplier: BoardCo, lead time 3d

2. QB-1238 — short 12 x RIH 400mm
   Needed by: Mon 18 May
   Suggested supplier: MetalWorks, lead time unknown

Actions: [Create draft] [Open in Unity] [Snooze today]
```

### Human-in-loop

The buyer must approve draft creation and later approve conversion into a real PO. The agent may write a draft to `purchase_order_drafts`, but should not create a live `purchase_orders` row without explicit approval.

### Edge cases

| Edge case                            | Handling                                                         |
| ------------------------------------ | ---------------------------------------------------------------- |
| Missing BOM                          | Create `missing_master_data` closure item, do not infer silently |
| No supplier component                | Create supplier-data closure item                                |
| Multiple suppliers                   | Rank by active supplier, lead time, price, MOQ; show rationale   |
| Existing draft already covers demand | Link to draft, do not create duplicate                           |
| Existing PO due too late             | Create late-risk item rather than "PO needed"                    |
| Fractional quantities                | Preserve numeric quantities; do not round boards/fabric/foam     |
| Reservations conflict                | Use reservation-aware availability, not raw inventory only       |

---

## 4.2 Capability 2 — PO draft and supplier-selection proposal

The pamphlet promises "drafts ready, waiting for your nod"; Unity already has shared org-scoped PO drafts and a transactional PO creation function.

### Data inputs

Read:

* `suppliercomponents`
* `suppliers`
* `supplier_emails`
* `purchase_order_drafts`
* `purchase_order_draft_lines`
* `supplier_order_customer_orders`
* `orders`
* `components`

Write only after approval:

* `purchase_order_drafts`
* `purchase_order_draft_lines`
* later, approved conversion through `create_purchase_order_with_lines(...)`

### Reasoning loop

Trigger:

```text
buyer taps [Create draft]
/draft PO for <order_number>
demand scan finds approved shortfall items
```

Process:

1. Gather all open `po_needed` closure items for selected scope.
2. Group by supplier.
3. Create draft title:

```text
AI draft — shortages for QB-1234, QB-1238 — 2026-05-08
```

4. Build line payload:
   * `component_id`
   * `supplier_component_id`
   * `quantity`
   * `customer_order_id`
   * allocations array
   * notes
5. Save through `save_purchase_order_draft(...)`.
6. Link draft ID back to closure items.
7. Ask buyer to review in Unity or approve next action.

### Output

Closure activity:

```text
proposal_created: "PO draft #42 created with 7 lines across 2 customer orders"
```

Telegram:

```text
✅ Draft ready

Draft #42: shortages for QB-1234, QB-1238
Supplier: BoardCo
Lines: 7
Total quantity: 41.9

No PO has been sent. Please review.

[Open draft] [Approve PO creation] [Reject] [Assign to buyer]
```

### Human-in-loop

The human must approve conversion from draft to real PO. For v1, prefer "Open draft in Unity" over approving entirely in Telegram unless Telegram callback identity mapping is already robust.

### Edge cases

| Edge case                                | Handling                                                         |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Buyer edits draft while agent updates it | Use `version` and conflict handling already present in draft RPC |
| Allocation sum exceeds quantity          | Let existing RPC validation block; surface concise error         |
| Supplier price stale                     | Add warning to notes and closure item                            |
| Lead time missing                        | Keep draft but create `missing_lead_time` closure item           |
| MOQ forces overbuy                       | Separate "for order" vs "for stock" allocations                  |
| Inactive supplier                        | Do not select unless buyer explicitly overrides                  |

---

## 4.3 Capability 3 — Late PO and supplier follow-up tracking

The sold story includes: "PO Q26-779 was due Tuesday. Job J401 slips Friday unless it lands."

### Data inputs

Read:

* `purchase_orders`
* `supplier_orders`
* `supplier_order_statuses`
* `supplier_order_receipts`
* `supplier_order_customer_orders`
* `orders.delivery_date`
* `suppliercomponents.lead_time`
* `suppliers`, `supplier_emails`
* `purchase_order_activity`, if present

The supplier-order type constants show the relevant statuses: open, in progress, approved, partially received, fully received, cancelled, draft, pending approval.

### Reasoning loop

Trigger:

```text
06:00 daily
*/30 business hours for already-due items
after a receipt event
after buyer marks supplier chased
```

Process:

1. Select supplier orders whose status is open/in-progress/approved/partially received.
2. Compute expected date:
   * explicit due date if field exists
   * else `order_date + suppliercomponents.lead_time`
   * else "unknown ETA" closure item if lead time missing.
3. Compare expected date with today.
4. Determine impacted customer orders via `supplier_order_customer_orders`.
5. Create/update one closure item per late supplier-order line.
6. If multiple lines on one PO are late, batch message by PO.
7. Generate supplier-chase text as a proposal only.

### Output

Closure item:

```text
source_type: supplier_order_late
source_id: <supplier_order_id>
item_type: late_po_line
title: "PO Q26-779 line 643 is 8 days late"
owner_role: purchasing
sla_minutes: 240
payload: {
  purchase_order_id,
  q_number,
  supplier_order_id,
  supplier_name,
  component_id,
  ordered_qty,
  received_qty,
  closed_qty,
  expected_date,
  impacted_orders
}
```

Telegram:

```text
🔴 Late PO risk

PO Q26-779 is 8 days late.
Worst impact: Job J401 / QB-1234 may slip Friday.
Supplier: BoardCo
Outstanding: 5 x Natural Oak 22mm
Last action: no chase logged

[Draft supplier chase] [Mark chased] [Close balance] [Open PO]
```

### Human-in-loop

The buyer approves any supplier email/WhatsApp text. The agent can draft:

```text
Hi <supplier>, please confirm ETA for PO Q26-779, line Natural Oak 22mm, outstanding 5 units. This is blocking production this week.
```

But it does not send without approval.

### Edge cases

| Edge case                         | Handling                                                 |
| --------------------------------- | -------------------------------------------------------- |
| Partial receipt                   | Track remaining quantity only                            |
| Balance formally closed           | Close late item with closure note                        |
| Supplier gave new ETA             | Pause SLA with `waiting_supplier_eta` or update due date |
| Missing lead time                 | Create master-data item instead of false overdue         |
| Multiple customer orders impacted | Show worst offender, put rest in payload                 |
| Supplier order cancelled/replaced | Close item and link replacement if known                 |

The balance-closure ledger and RPC are already designed for audited closure of partially received PO balances.

---

## 4.4 Capability 4 — Delivery-note OCR and PO receipt matching

This is the most proven workflow. POL-101 says Matt already caught four unrecepted Natural Oak boards on PO Q26-395 in the QButton POC, and the new work is to promote that from a one-off skill to a closure-engine workflow.

### Data inputs

Read:

* Telegram image
* OCR text/structured result from Gemini 3 Flash
* `purchase_orders.q_number`
* `supplier_orders`
* `suppliercomponents.supplier_code`
* `components.internal_code`
* `supplier_order_receipts`
* `inventory_transactions`
* `supplier_order_balance_closures`

Write after approval:

* `supplier_order_receipts`
* `inventory_transactions`
* `inventory`
* via `process_supplier_order_receipt(...)`

The receipt RPC already locks supplier orders, validates remaining quantities, creates inventory transactions, updates inventory, records receipts, handles rejections, and updates order status.

### Reasoning loop

Trigger:

```text
Telegram photo received
Telegram caption mentions delivery note / PO / supplier
```

Process:

1. Store original photo under org-scoped storage path.
2. OCR with Gemini 3 Flash.
3. Extract:
   * supplier name
   * delivery note number
   * PO/Q number
   * line descriptions
   * supplier codes
   * quantities
   * units
4. Match PO:
   * exact Q number first
   * supplier + supplier code second
   * fuzzy component description last
5. For each line:
   * compare delivered qty to outstanding qty
   * assign confidence
   * classify clean / short / over / unknown / duplicate
6. For clean lines, create a receipt proposal.
7. For exception lines, create closure items.
8. Send one concise Telegram response.

### Output

For clean receipt proposal:

```text
🧾 Delivery note matched

PO: Q26-395
Supplier: BoardCo
Clean lines: 3
Exceptions: 0

No stock has been received yet.
[Receive these lines] [Open PO] [Reject OCR]
```

For exception:

```text
🧾 Delivery note needs review

PO Q26-395 — 2 issues

1. Natural Oak 22mm
   Ordered outstanding: 5
   Delivery note: 4
   Issue: short by 1

2. Oak Board 18mm
   Delivery note line not found on PO
   Confidence: 62%

[Open review] [Assign to buyer] [Close as accepted variance]
```

Closure item:

```text
source_type: delivery_note_line
source_id: <delivery_note_id>:<line_index>
item_type: delivery_mismatch
title: "PO Q26-395 short 1 x Natural Oak 22mm"
owner_role: purchasing
sla_minutes: 240
```

### Human-in-loop

Even clean lines require approval before calling `process_supplier_order_receipt(...)`. Telegram approval is acceptable only after `telegram_user_bindings` maps the Telegram user to a Unity `auth.users.id`.

### Edge cases

| Edge case                          | Handling                                             |
| ---------------------------------- | ---------------------------------------------------- |
| Poor photo                         | Ask for retake; no closure spam                      |
| No PO number                       | Ask "Which PO is this for?" with candidates          |
| Multiple POs on one note           | Split proposals by PO                                |
| Duplicate delivery-note upload     | Detect by image hash + supplier + note number        |
| Over-delivery                      | Do not receive unless buyer approves and RPC permits |
| Rejected quantity                  | Use receipt RPC rejection fields                     |
| Fractional units                   | Preserve numeric values                              |
| Handwritten supplier code mismatch | Low confidence -> review                             |

---

## 4.5 Capability 5 — Stock count and inventory drift watcher

The sold story includes "Twenty-four boards expected. Eighteen counted. Pattern points to over-issue on J389."

### Data inputs

Read:

* Telegram photo or voice note
* `components`
* `inventory`
* `inventory_transactions`
* `supplier_order_receipts`
* `stock_issuances`
* `stock_issuance_reversals`, if present
* `job_work_pool`, `job_cards`, `job_card_items`
* `orders`
* `component_reservations`

The stock issuance implementation records stock leaving inventory against orders/components, with inventory transactions and `stock_issuances`.

Optional new table for count evidence:

```sql
create table if not exists public.agent_stock_counts (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  component_id         integer references public.components(component_id),
  location             text,
  counted_qty          numeric not null,
  system_qty_at_count  numeric,
  count_source         text not null check (count_source in ('telegram_photo', 'telegram_voice', 'manual_text')),
  source_message_id    text,
  photo_storage_path   text,
  counted_by_user_id   uuid references auth.users(id),
  counted_by_agent_id  text,
  confidence           numeric,
  notes                text,
  created_at           timestamptz not null default timezone('utc', now())
);
```

### Reasoning loop

Trigger:

```text
Telegram stock-count photo/voice
weekly drift scan
manual: /count <component> <qty>
```

Process:

1. Extract component identity and count.
2. Match to `components.internal_code`, description, supplier codes.
3. Compare physical count to `inventory.quantity_on_hand`.
4. If variance above threshold, create closure item.
5. Trace recent movements:
   * receipts
   * stock issuances
   * reversals
   * manual adjustments
   * relevant job/order links
6. Suggest likely cause only if evidence is strong.

### Output

Closure item:

```text
source_type: stock_count_variance
source_id: <agent_stock_count_id>
item_type: inventory_variance
title: "Natural Oak 22mm count is 6 below system"
owner_role: stores
sla_minutes: 480
payload: {
  component_id,
  counted_qty,
  system_qty,
  variance,
  recent_receipts,
  recent_issuances,
  suspected_source_order_id
}
```

Telegram:

```text
🟠 Stock variance

Natural Oak 22mm
System: 24
Counted: 18
Variance: -6

Likely contributors:
• J389 issued 5 more than expected yesterday
• PO Q26-395 had 4 boards delivered but not received

[Recount] [Open variance] [Assign] [Propose adjustment]
```

### Human-in-loop

The agent may propose a stock adjustment but cannot execute it in v1. Adjustment approval should require a named human and a reason code.

### Edge cases

| Edge case                             | Handling                                                  |
| ------------------------------------- | --------------------------------------------------------- |
| Location is not first-class           | Store raw location text; do not pretend multi-bin exists  |
| Offcuts/partial boards                | Record unit ambiguity in notes                            |
| Component match ambiguous             | Ask one clarification question                            |
| Concurrent receipt/issue              | Snapshot `system_qty_at_count` and re-check before action |
| Legitimate consumption not posted yet | Link to stock issuance/job-card owner                     |
| Recount resolves variance             | Auto-close with closure note                              |

---

# 5. Telegram UX

The product lives or dies by "considered messaging." The positioning doc is explicit: silent by default, one message per cycle, escalation earned by age, never resurface closed items, distinguish action from FYI, tight format, quiet outside business hours.

## 5.1 Per-user thread design

Use `telegram_user_bindings` to bind Telegram identities to Unity users and roles.

| User type                 | Thread                        | Messages                                                    |
| ------------------------- | ----------------------------- | ----------------------------------------------------------- |
| Buyer / purchasing clerk  | DM with Purchasing Agent      | Detailed actions, approvals, supplier chase drafts          |
| Stores / receiving person | DM or shared receiving thread | Photo intake, recount requests, delivery-note clarification |
| Supervisor                | DM                            | Escalations only                                            |
| MD / owner                | DM                            | Daily Control-Tower Brief, worst offenders, closure rate    |
| Internal Polygon admin    | Separate admin thread         | Agent health, errors, dry-run findings during rollout       |

Do not send to "last channel." Store `telegram_chat_id` per user/org/capability. POL-104 specifically calls out pinned target chat configuration for the daily brief.

## 5.2 Photo intake

Flow:

```text
User sends photo
Agent stores original image
OCR extracts structured fields
Agent asks one clarification only if needed
Agent creates proposal/closure item
Agent sends one response
```

Accepted photo types:

* Delivery notes.
* Stock counts/count sheets.
* Labels / supplier packaging.
* Damaged/incorrect item evidence.

Never book stock from a photo without approval.

## 5.3 Voice intake

OpenClaw already supports Telegram voice transcription via Groq.

Example:

```text
User voice: "Count for Natural Oak twenty-two mil is eighteen boards in the front store."

Agent extracts:
component: Natural Oak 22mm
qty: 18
location: front store
intent: stock_count
```

Reply:

```text
I found Natural Oak 22mm, front store, count 18.
System says 24. Open variance?
[Yes] [No, wrong item]
```

## 5.4 Outbound message format

Use stable, scannable messages.

```text
🔴 Purchasing — 3 actions

1. PO Q26-779 — 8d late
   Blocks: J401 / QB-1234, due Friday
   Owner: Thandi
   Action: chase supplier today

2. QB-1238 — PO needed
   Short: 12 x RIH 400mm
   Needed by: Monday

Closed since yesterday: 4

[Open Unity] [Assign all] [Brief settings]
```

Rules:

* Maximum 5 detailed items in any message.
* Show counts for the rest.
* Never repeat the same item at the same urgency unless new evidence appears.
* Every action item needs an owner or an explicit "unassigned" warning.
* Every button maps to an auditable event.

## 5.5 Daily brief

POL-104 defines the brief as the visible proof that the nervous system is real: scheduled per org, Telegram delivery, stable section order, count + worst offender + age, and closure rate since yesterday.

Recommended QButton v1 brief:

```text
07:05 Mon-Sat

Recipient: MD + buyer

Sections:
1. POs needed today
2. Late POs / supplier risk
3. Delivery-note exceptions
4. Stock variances
5. Waiting on approval
6. Closed since yesterday
```

Format:

```text
📍 QButton Purchasing Brief — Fri 8 May

🔴 Late POs: 2
Worst: Q26-779, 8d late, blocks J401 Friday.

🟠 POs needed today: 3
Worst: QB-1234 short 6 x Natural Oak 22mm.

🟠 Delivery exceptions: 1
PO Q26-395 short 1 board.

✅ Closed since yesterday: 4
• 2 delivery mismatches
• 1 stock variance
• 1 PO draft approved

[Open queue] [Buyer actions] [Mute today]
```

How it stays above the considered-messaging bar:

* Send one brief, not item-by-item pings.
* Skip the brief if there are truly no open items and no closure changes, unless MD explicitly opts into a quiet "no actions" line during onboarding.
* Do not show closed items again except in "closed since yesterday."
* Promote aged items only when escalation level changes.
* Keep "FYI" out of live pings; put it in the brief.

---

# 6. Testing and live-data safety

QButton's real Supabase project cannot be polluted with synthetic operational data. The staged rollout must separate schema/agent metadata from business writes.

## 6.1 Stage 0 — Local-only synthetic tests

Use local Supabase or isolated test DB.

Test:

* Closure engine migrations.
* RLS policies.
* Matching logic with fabricated orders/POs.
* OCR parser with redacted fixture images.
* Idempotency keys.
* Message batching/dedupe.
* Edge Function payload validation.

No production connection.

## 6.2 Stage 1 — Production read-only shadow

Mode:

```text
agent_org_config.mode = 'shadow'
```

Rules:

* Read QButton production data through read-only agent identity.
* No closure items yet.
* No Telegram messages to QButton.
* Send findings to internal Polygon admin thread.
* Compare against known QButton POC cases.

Acceptance:

* No cross-org query possible.
* Findings make sense on real open POs/orders.
* No unexpected table scans or large model contexts.

## 6.3 Stage 2 — Dry-run write to agent logs only

Mode:

```text
agent_org_config.mode = 'dry_run'
```

Allowed production writes:

* `agent_action_log`
* `agent_watched_items`

No operational writes. No PO drafts, receipts, stock movements, or closure items yet.

Purpose:

* Prove idempotency.
* Prove feature flags.
* Prove no spam.
* Measure false positives.

## 6.4 Stage 3 — Closure-only live

Mode:

```text
agent_org_config.mode = 'closure_only'
```

Allowed writes:

* `closure_items`
* `closure_item_activity`
* `agent_action_log`
* `agent_watched_items`
* Telegram messages to selected QButton users

No business writes.

This is the first customer-visible nervous-system layer.

## 6.5 Stage 4 — Proposal writes

Mode:

```text
agent_org_config.mode = 'proposal_writes'
```

Allowed business-adjacent writes:

* `purchase_order_drafts`
* delivery-note proposal records
* stock-count evidence rows

Still not allowed:

* live `purchase_orders`
* `supplier_order_receipts`
* `inventory_transactions`
* stock adjustments
* supplier emails

## 6.6 Stage 5 — Approved live writes

Mode:

```text
agent_org_config.mode = 'live_approved_writes'
```

Allowed only after human approval:

* Convert draft to PO.
* Receive matched delivery lines via `process_supplier_order_receipt(...)`.
* Close supplier-order balance via `close_supplier_order_balance(...)`.
* Record approved adjustment through existing/manual process if available.

Every approved action must record:

```text
who approved
telegram_user_id
mapped Unity user_id
payload hash
target rows
before/after summary
closure item link
```

## 6.7 Safety checks before Stage 3

Must pass:

1. `mcp__supabase__get_advisors` or equivalent RLS advisor check.
2. Attempted cross-org read returns zero rows.
3. Agent credential cannot set arbitrary `org_id`.
4. Edge Function rejects missing/invalid idempotency key.
5. Duplicate delivery note does not create duplicate closure item.
6. Telegram unknown sender cannot pair without code.
7. All model prompts redact secrets and do not include service-role keys.
8. Plaintext `openclaw.json` secrets are removed/rotated.

---

# 7. Deployment and operations

## 7.1 `ocmac-air` production hardening

Before customer launch:

| Area     | Required action                                                     |
| -------- | ------------------------------------------------------------------- |
| OS/user  | Dedicated `openclaw` macOS user; no personal browsing/dev work      |
| Disk     | FileVault enabled                                                   |
| Network  | Tailscale locked down; macOS firewall on                            |
| Power    | Keep charger/UPS stable; prevent sleep while plugged in             |
| Process  | Run OpenClaw under `launchd` or `pm2`; auto-start on boot           |
| Logs     | JSON logs to local rotating files + Supabase `agent_runtime_events` |
| Health   | Heartbeat row every 5 minutes                                       |
| Alerting | Telegram admin alert if down >10 minutes                            |
| Repo     | Clean checkout, pinned branch/tag for production                    |
| Updates  | No automatic disruptive OS updates during business hours            |

POL-48 already captures the need for auto-restart and observability.

## 7.2 Secrets cleanup

The brief calls out plaintext secrets in `openclaw.json` as a blocker. Treat this as a launch gate.

Immediate 30-day approach:

1. Remove all secrets from `~/.openclaw/openclaw.json`.
2. Replace with environment variable names only.
3. Rotate any secret that was committed, pasted, or stored plaintext:
   * Telegram bot token
   * Supabase service-role key
   * Supabase anon/auth tokens
   * OpenAI/Gemini/Groq keys
   * agent API key
4. Store local runtime secrets outside the repo:
   * Preferred on macOS: Keychain, loaded by a wrapper script.
   * Acceptable short-term fallback: `~/.openclaw/secrets.env`, `chmod 600`, owner `openclaw`, never synced/committed.
5. Move all service-role use to Supabase Edge Function secrets where possible.
6. Agent local key should be an `agent_credentials` API key, not the Supabase service-role key.
7. Add a boot-time check that refuses to start if required env vars are missing.

Example wrapper shape:

```bash
#!/usr/bin/env bash
set -euo pipefail
export TELEGRAM_BOT_TOKEN="$(security find-generic-password -a openclaw -s qbutton_telegram_bot -w)"
export OPENAI_API_KEY="$(security find-generic-password -a openclaw -s openai_api_key -w)"
export GEMINI_API_KEY="$(security find-generic-password -a openclaw -s gemini_api_key -w)"
export GROQ_API_KEY="$(security find-generic-password -a openclaw -s groq_api_key -w)"
export PURCHASING_AGENT_API_KEY="$(security find-generic-password -a openclaw -s purchasing_agent_api_key -w)"
exec openclaw start --config "$HOME/.openclaw/openclaw.json"
```

The existing flyer-agent proof-of-concept already uses hashed agent credentials and Edge Function service-role isolation; reuse that pattern.

## 7.3 Observability

Add:

```sql
create table if not exists public.agent_runtime_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.organizations(id),
  agent_id        text not null,
  host_id         text not null,
  event_type      text not null,
  severity        text not null default 'info',
  message         text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default timezone('utc', now())
);

create table if not exists public.agent_heartbeats (
  agent_id        text primary key,
  host_id         text not null,
  org_id          uuid references public.organizations(id),
  status          text not null,
  last_seen_at    timestamptz not null default timezone('utc', now()),
  last_run_id     uuid,
  payload         jsonb not null default '{}'::jsonb
);
```

Watch:

* Last successful cron by capability.
* Edge Function error rate.
* Telegram delivery failures.
* LLM token spend per day.
* Closure item creation rate.
* Closure item aging.
* Duplicate suppression count.
* Human approval/rejection rate.

A "real failure" is not only a crash. A real failure includes silent no-ops, repeated noisy pings, cross-tenant access risk, and unapproved operational writes.

## 7.4 Backup and disaster recovery

Source of truth:

* Supabase for business data and closure state.
* GitHub repo for code.
* Encrypted secret backup for agent credentials.
* OpenClaw workspace memory/config backup for continuity.

Back up daily:

```text
~/.openclaw/workspace
~/.openclaw/config minus secrets
agent SOUL/TOOLS/HEARTBEAT/MEMORY files
launchd plist
deployment runbook
```

RTO targets:

| Scenario                            |                           RTO if prepared | RTO if not prepared |
| ----------------------------------- | ----------------------------------------: | ------------------: |
| OpenClaw process crash              |                                   <10 min |           30–60 min |
| Mac reboot                          |                                   <15 min |              1–2 hr |
| Mac hardware death with spare ready |                                    2–4 hr |      1 business day |
| Supabase outage                     | Outside agent control; Unity affected too |                Same |

For the first paid customer, prepare a spare-host runbook even if no warm spare exists.

---

# 8. 30-day implementation sequence

## Critical path

Start immediately:

1. POL-100 closure engine.
2. Secrets cleanup and key rotation.
3. QButton `org_id` / user / Telegram binding.
4. Read-only agent identity and RLS verification.
5. Delivery-note OCR workflow promotion from POC to closure-engine item.
6. Daily brief template over closure engine.

## Week 1 — Platform safety and POL-100

| Day | Work                                                                                           | Exit criteria                                 |
| --: | ---------------------------------------------------------------------------------------------- | --------------------------------------------- |
|   1 | Confirm QButton org/users, create `agent_org_config`, create `telegram_user_bindings` skeleton | QButton org locked; named buyer/MD targets    |
|   1 | Remove secrets from `openclaw.json`; rotate exposed keys                                       | Agent starts with env/Keychain secrets only   |
|   2 | Create read-only agent identity and Edge Function credential                                   | Reads use RLS; writes use `agent_credentials` |
| 2–4 | Build `closure_items`, activity, pauses, escalation events                                     | Local migration passes                        |
|   4 | Implement closure RPCs and Edge wrapper                                                        | Idempotent register/update/close works        |
|   5 | Backfill/bridge from `job_work_pool_exceptions`                                                | Existing exceptions visible as closure items  |
|   6 | RLS/advisor verification                                                                       | No broad policies; org-scoped reads only      |
|   7 | Agent action log + watched items + message outbox                                              | Duplicate suppression works                   |

## Week 2 — Receiving + brief, in shadow first

| Day | Work                                               | Exit criteria                               |
| --: | -------------------------------------------------- | ------------------------------------------- |
|   8 | Wire Telegram photo intake to delivery-note parser | Photo -> structured OCR result              |
|   9 | Implement PO/line matcher                          | Q number, supplier code, component matching |
|  10 | Convert mismatches into closure items              | One active item per delivery-note issue     |
|  11 | Build receipt proposal flow                        | No receipt write yet                        |
|  12 | Daily brief v1 over closure queue                  | Internal Polygon brief stable               |
|  13 | Production shadow on QButton real data             | Internal-only findings validated            |
|  14 | Customer kickoff readiness review                  | Safe to enable closure-only mode            |

The one-month free trial starts around here. The customer should see a working but conservative agent, not a half-built autonomous workflow.

## Week 3 — Buyer-facing purchasing workflow

| Day | Work                                           | Exit criteria                                            |
| --: | ---------------------------------------------- | -------------------------------------------------------- |
|  15 | Enable Telegram for buyer/MD in `closure_only` | Real closure items, real messages                        |
|  16 | Demand shortfall scan                          | Open orders -> shortage closure items                    |
|  17 | PO draft proposal                              | Shortage items -> `purchase_order_drafts` after approval |
|  18 | Late PO scan                                   | Overdue supplier-order items created                     |
|  19 | Supplier chase proposal                        | Draft chase text, no autonomous send                     |
|  20 | Approval callback hardening                    | Telegram approvals map to Unity user                     |
|  21 | Move selected flows to `proposal_writes`       | Drafts can be created with approval                      |

## Week 4 — Stock drift, approved writes, hardening

| Day | Work                           | Exit criteria                                           |
| --: | ------------------------------ | ------------------------------------------------------- |
|  22 | Stock-count photo/voice intake | Count -> component match -> variance item               |
|  23 | Inventory drift trace          | Variance points to receipts/issues where possible       |
|  24 | Approved receipt execution     | Human-approved clean delivery lines call receipt RPC    |
|  25 | Closure analytics              | Aging, closed since yesterday, rejection rate           |
|  26 | Noise tuning                   | No repeated same-level pings                            |
|  27 | Failure drills                 | Restart, duplicate note, bad OCR, no supplier lead time |
|  28 | Customer acceptance review     | Buyer/MD confirm usefulness                             |
|  29 | Documentation and runbook      | Operator SOP + support SOP                              |
|  30 | Trial production cut           | Feature flags set, monitoring on, backlog for phase 2   |

## What slips if needed

Cut in this order:

1. Stock drift pattern analysis beyond simple count variance.
2. Telegram approval for PO conversion; use "Open in Unity" instead.
3. Supplier chase sending; keep draft text only.
4. Production exception bridge beyond backfill.
5. Dashboard; explicitly phase 2.

Do not cut:

* Secrets cleanup.
* Closure engine.
* RLS safety.
* Audit logging.
* Human approval boundary.
* Message dedupe.

---

# 9. Risk register

## Top technical risks

| Risk                         | What could go wrong                          | Early signal                                      | Mitigation                                                                   |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Closure engine overrun       | POL-100 consumes the whole month             | DDL/RPC not working by Day 5                      | Ship minimal closure core: item, activity, close, SLA; postpone UI           |
| Tenant/data safety failure   | Agent sees or writes outside QButton         | RLS advisor warnings, queries without org filters | Read-only identity, Edge Functions derive org from credential, feature flags |
| OCR/matching false positives | Wrong receipt proposal or wrong closure item | Human rejects >20% of OCR matches                 | High confidence threshold; ask clarification; never auto-receive             |
| Spam/noise                   | Humans mute the bot                          | More than 2 non-action pings/day/user             | Watched-item fingerprints, daily batching, escalation-on-level-change only   |
| M1 host reliability          | Agent misses scans or crashes silently       | Heartbeat stale >10 minutes                       | launchd/pm2, admin alerts, startup reconciliation, spare-host runbook        |

## Top operational risks

| Risk                  | What could go wrong                                          | Early signal                     | Mitigation                                                                 |
| --------------------- | ------------------------------------------------------------ | -------------------------------- | -------------------------------------------------------------------------- |
| QButton adoption weak | Buyer/MD ignores messages                                    | Open items age without replies   | Train one champion; keep messages button-driven and sparse                 |
| Master data poor      | Missing lead times/supplier components block recommendations | Many `missing_master_data` items | Treat master-data cleanup as visible closure queue, not hidden tech debt   |
| Solo support overload | Engineer becomes the workflow                                | Manual corrections >30 min/day   | Aggressive scope cuts, feature flags, internal admin brief, documented SOP |

---

# 10. Resourcing

## 10.1 LLM token-cost projection

I cannot verify current external model pricing from the live web in this environment, so this uses the repo's internal cost assumptions and should be rechecked before quoting long-term margins. The OpenClaw architecture doc estimates $20–50/month for 3–6 business-hour agents with optimization and gives the cost-control principle: keep Supabase results focused, use cheaper models for OCR/classification/heartbeats, and reserve reasoning models for complex cases.

Assumed QButton daily volume:

| Workload                    | Volume assumption | Model                            |
| --------------------------- | ----------------: | -------------------------------- |
| Delivery-note OCR           |    3–8 photos/day | Gemini 3 Flash                   |
| Stock count photo/voice     |           0–5/day | Gemini 3 Flash + Groq voice      |
| Demand scan summaries       |             1/day | GPT-5.4-mini, occasional GPT-5.5 |
| Late PO scan summaries      |             2/day | GPT-5.4-mini                     |
| Complex matching/reasoning  |           3–8/day | GPT-5.5 reasoning                |
| Daily brief                 |             1/day | GPT-5.4-mini                     |
| Telegram message formatting |          5–20/day | GPT-5.4-mini                     |

Rough monthly usage:

| Model class         |                  Monthly input |    Monthly output | Cost expectation                                  |
| ------------------- | -----------------------------: | ----------------: | ------------------------------------------------- |
| GPT-5.5 reasoning   |                    1–2M tokens |   100–250k tokens | Low tens of USD unless overused                   |
| GPT-5.4-mini        |                    1–3M tokens |   200–500k tokens | Single-digit to low tens USD                      |
| Gemini Flash vision | 0.5–2M effective tokens/images | small text output | Single-digit USD if Flash pricing remains similar |
| Groq voice          |                 <2 hours/month |   transcript only | Negligible                                        |

Budget:

```text
Expected pilot: USD $10–50/month
Set alert: USD $50/month
Hard cap / investigate: USD $100/month
```

At R600/week, even R500/month of model/runtime cost is acceptable, but noisy prompts and large DB dumps could destroy the margin. The implementation must log tokens per run.

## 10.2 Hardware

Stay on `ocmac-air` for QButton.

Upgrade/move only when one of these becomes true:

* More than 2–3 paying customers depend on the same host.
* Required RTO drops below 2 hours.
* Local model inference becomes part of production.
* Telegram/agent volume makes the M1 visibly slow.
* You need formal hosting/security assurances for larger clients.

Near-term improvement: prepare a spare Mac or small cloud VM runbook, but do not migrate before the trial.

## 10.3 Single-engineer timeline realism

**30 days is achievable solo for the sold QButton Purchasing Agent v1** if scope is held to:

* Closure engine core.
* Telegram-first UX.
* Read-only scans.
* Closure items and daily brief.
* PO draft proposals.
* Human-approved receipt execution.
* Stock-count variance capture.
* No dashboard.
* No autonomous supplier sending.
* No broad multi-agent mesh.
* No full inter-site transfer ledger unless treated as a separate parallel schema-only task.

**30 days is not realistic solo** if the target includes all of these at production quality:

* Full POL-100 closure engine.
* Receiving agent.
* Inter-site transfer ledger and agent.
* Production exception triage agent.
* Daily brief agent.
* Purchasing Agent five-stage cycle.
* Dashboard.
* Supplier email automation.
* Full operational writeback suite.

That combined scope is closer to **45 days minimum**, and more realistically 60 if customer feedback loops are included. For the actual sold Purchasing Agent trial, ship the constrained version in 30 days and make the closure engine the reusable foundation for the next customers.
