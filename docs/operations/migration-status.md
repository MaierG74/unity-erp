# Migration Status (All Environments)

Use this file to track migration rollout state by environment.  
Source of truth for what is actually applied is still Supabase migration history (`supabase_migrations` via MCP `list_migrations`).

## How To Update
1. Apply migration(s) with approved workflow.
2. Run Supabase MCP `list_migrations` for the environment.
3. Record latest applied version and notes below.

## Local
- Environment: Local dev DB
- Latest applied migration version:
- Latest applied migration name:
- Applied at (UTC):
- Applied by:
- Verification notes:

## Staging
- Environment: Staging project
- Project ref: xhlfwnryxsrzasoopoat
- Latest applied migration version:
- Latest applied migration name:
- Applied at (UTC):
- Applied by:
- Verification notes:

## Production
- Environment: Production project
- Project ref: ttlyfhkrsjjrzxiagzpb
- Latest applied migration version: 20260510143640
- Latest applied migration name: agent_runtime_support_tables
- Applied at (UTC): 2026-05-10 14:36 UTC
- Applied by: Claude Code via Supabase MCP for Unity production (`ttlyfhkrsjjrzxiagzpb`)
- Verification notes:
  - Current batch (2026-05-10, Claude Code) — POL-112 (agent runtime support tables; 6 tables sibling to POL-100 closure engine).
    1. `agent_runtime_support_tables` (20260510143640; local file `20260510100000_agent_runtime_support_tables.sql`): created the six cross-cutting agent-runtime tables per plan §2.2 + §7.3. `public.agent_action_log` (21 cols, 5 explicit indexes incl. the load-bearing partial-unique `agent_action_log_idempotency_unique` on `(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL` for Edge Function idempotency; 9-state `action_kind` CHECK including 'observation'; FK to `closure_items.id` ON DELETE SET NULL); `public.agent_watched_items` (20 cols, 3 explicit indexes incl. dedup unique on `(org_id, agent_id, capability, source_fingerprint)`; 5-state `state` CHECK including 'awaiting_better_photo' for the OCR re-shoot loop; FK to `closure_items.id` ON DELETE SET NULL); `public.agent_org_config` (10 cols, composite PK `(org_id, agent_id, capability)`; 6-state `mode` CHECK off→shadow→dry_run→closure_only→proposal_writes→live_approved_writes; `daily_brief_time` default '07:05', `timezone` default 'Africa/Johannesburg'); `public.telegram_user_bindings` (11 cols, 3 indexes incl. UNIQUE `(org_id, telegram_user_id)`); `public.agent_runtime_events` (9 cols, 3 indexes; `org_id` nullable for host-wide events); `public.agent_heartbeats` (7 cols, 2 indexes; PK on `agent_id`).
    2. RLS enabled on all 6 with one `org_read_<table>` SELECT policy each via `public.is_org_member(org_id)`. **No INSERT/UPDATE/DELETE policies for authenticated users** — writes go via service_role through Edge Functions / RPCs (per ticket: "writes go via RPCs/Edge Functions only"). Service role bypasses RLS as expected. `is_org_member(NULL)` returns false → host-level rows in `agent_runtime_events` and `agent_heartbeats` (where `org_id IS NULL`) are visible only to service_role / postgres.
    3. `set_updated_at` trigger wired to `agent_watched_items`, `agent_org_config`, and `telegram_user_bindings` (the three tables with mutable lifecycles). `agent_action_log` is append-only (no `updated_at`). `agent_runtime_events` is append-only event log. `agent_heartbeats` updates via service_role overwriting `last_seen_at` directly.
    4. Verified with MCP `list_migrations`: production history now ends at `20260510143640 agent_runtime_support_tables`.
    5. Verified with MCP SQL: all 6 tables exist with RLS enabled and 1 policy each. Column counts (21, 20, 10, 11, 9, 7) and index counts (6, 4, 1, 4, 4, 3 — including each table's PK index) match the spec.
    6. Verified with MCP `get_advisors` (security): zero advisor findings reference any of the 6 new tables (or substrings 'agent', 'telegram', 'heartbeat', 'watched'). All existing advisor noise is on pre-existing entities.
    7. Cross-org-read smoke: anon `SELECT count(*)` against each of the 6 tables (run via `SET LOCAL ROLE anon`) returns `0` — RLS correctly denies anon visibility because `is_org_member(NULL_uid)` is false.
    8. **Out of scope for POL-112 (deferred to follow-up tickets):** Edge Function wrappers for the 9 closure-engine RPCs (now unblocked since `agent_action_log.idempotency_key` partial-unique exists); cron heartbeat updater for `agent_heartbeats`; Telegram bot setup; any front-end UI that reads these tables (POL-106).
  - Current batch (2026-05-09, Claude Code) — POL-111 (closure engine, sub-issue e of 5 for POL-100; bridge from `job_work_pool_exceptions`). **POL-100's full sub-tree is now complete.**
    1. `closure_engine_bridge` (20260509155115; local file `20260509103000_closure_engine_bridge.sql`): added the bridge from `job_work_pool_exceptions` → `closure_items` per plan §3.7. Four IMMUTABLE helpers (`_closure_bridge_severity_for_variance`, `_status_for_source`, `_event_for_source`, `_payload`); three SECURITY DEFINER trigger functions (`_closure_bridge_on_exception_insert`, `_on_exception_update`, `_on_activity_insert`); three triggers wired to the source tables (AFTER INSERT and AFTER UPDATE on `job_work_pool_exceptions`, AFTER INSERT on `job_work_pool_exception_activity`); idempotent backfill DO block for currently-open exceptions (zero rows in production today, no-op).
    2. **One-way mirror (source → mirror).** New writes to `closure_items` do NOT propagate back to `job_work_pool_exceptions`. Manufacturing UI reads the source unchanged.
    3. **Resilience policy:** trigger errors `RAISE WARNING` and let the source operation succeed. Trade-off is silent drift on bridge bugs (mitigated by future reconciliation cron). Manufacturing UI keeps working even if the bridge has a bug.
    4. **Mappings:** source `status` 'open' → 'open', 'acknowledged' → 'in_progress', 'resolved' → 'closed' (with `closure_note` from `resolution_notes`). Source `event_type` 'created' → 'created', 'acknowledged' → 'status_changed', 'resolved'/'auto_resolved' → 'closed', everything else → 'observation_updated'. Severity derived from `abs(variance_qty)`: ≥50 high, ≥10 medium, else low. Source rows linked to mirrors via `source_fingerprint = 'job_work_pool_exception:' || exception_id`.
    5. `fix_closure_bridge_helper_search_path` (20260509155319; local file `20260509103500_fix_closure_bridge_helper_search_path.sql`): same-session hotfix — the 4 IMMUTABLE helpers were missing `SET search_path = public`, which `get_advisors` flags as `function_search_path_mutable`. The SECURITY DEFINER trigger functions had it set; helpers got skipped because they don't touch tables. Added for consistency with the hardening direction.
    6. Verified with MCP `list_migrations`: production history now ends at `20260509155319 fix_closure_bridge_helper_search_path`.
    7. Verified with MCP `get_advisors` (security): zero advisor findings reference any of the bridge helpers, trigger functions, or triggers.
    8. Functional smoke (transactional DO block, intentional rollback at the end via `RAISE EXCEPTION`): inserted a fake exception with real FK targets (org=99183187…, order=592, work_pool=56, exception_type='cutting_plan_issued_count_changed', variance_qty=15) — verified mirror created, status='open', severity='medium', 1 'created' activity row from the bridge insert trigger. Inserted a `variance_changed` source activity row — verified bridge mapped it to 'observation_updated' and appended to mirror activity (now 2 rows). UPDATEd source to status='acknowledged' — verified mirror status flipped to 'in_progress'. UPDATEd source to status='resolved' with `resolution_notes='POL-111 smoke complete'` — verified mirror status='closed' with the note copied to `closure_note` and `closed_at` populated. Rollback confirmed: zero residue (smoke_exceptions/smoke_mirrors/smoke_activity = 0).
    9. **POL-100 sub-tree complete:** POL-107 (tables) → POL-108 (pauses + escalations) → POL-109 (RPCs) → POL-110 (queue view) → POL-111 (bridge). The closure-engine SQL surface is fully shipped.
    10. Next-up dependencies: POL-112 (agent runtime support tables, independent), POL-113 (secrets cleanup), POL-114 (Gemma server hardening). Edge Function wrappers for POL-109 RPCs depend on POL-112 (`agent_action_log` for idempotency).
  - Current batch (2026-05-09, Claude Code) — POL-110 (closure engine, sub-issue d of 5 for POL-100; computed queue view):
    1. `closure_items_queue_view` (local file `20260509093000_closure_items_queue_view.sql`): created `public.closure_items_queue` view wrapping `closure_items` with three computed columns — `age_minutes` (accounts for `total_paused_seconds`; freezes at `closed_at` for terminal items), `minutes_until_due` (NULL when `due_at` is NULL; negative when past due), `sla_breached` (TRUE only when `due_at` is set AND `NOW() > due_at`).
    2. View created `WITH (security_invoker = true)` so RLS on `closure_items` propagates to view callers — authenticated users see only their own org's rows; service_role (Edge Functions) bypasses RLS as expected. Avoids the `security_definer_view` advisor class that the project is otherwise littered with.
    3. Verified with MCP SQL: view exists with `reloptions = 'security_invoker=true'`. Anon `SELECT count(*) FROM public.closure_items_queue` returns 0 rows (proves RLS propagation via security_invoker).
    4. Verified with MCP `get_advisors` (security): zero advisor findings reference the new view.
    5. Functional smoke (transactional DO block, cleaned up post-run) confirmed: a row inserted at `opened_at = NOW() - 30 min`, `total_paused_seconds = 60`, `due_at = NOW() - 5 min` returned `age_minutes ≈ 29`, `minutes_until_due ≈ -5`, `sla_breached = TRUE`. A separate row with `due_at = NULL` returned `minutes_until_due = NULL` and `sla_breached = FALSE` correctly.
    6. POL-111 (bridge migration from `job_work_pool_exceptions`) is the only POL-100 sub-issue remaining.
  - Current batch (2026-05-09, Claude Code) — POL-109 (closure engine, sub-issue c of 5 for POL-100; RPC API surface):
    1. `closure_engine_rpcs` (20260509075112; local file `20260509083000_closure_engine_rpcs.sql`): created the 9 SQL RPCs that wrap closure-engine state transitions, plus the internal `_closure_log_activity` helper. RPCs: `register_closure_item` (idempotent by source_fingerprint), `record_closure_observation`, `assign_closure_item`, `set_closure_status` (non-terminal, non-paused only), `pause_closure_sla` (returns pause_id), `resume_closure_sla` (returns seconds added), `close_closure_item` (requires non-empty closure_note; auto-resumes any open pause first), `escalate_due_closure_items(p_org_id)` (cron-driven walker, advances escalation_level + writes closure_escalation_events row + recomputes next_escalation_at from `escalation_policy.steps[new_level].after_minutes`), `get_daily_closure_brief(p_org_id, p_since)` (returns single jsonb summary).
    2. All RPCs `SECURITY DEFINER` with `SET search_path = public`. EXECUTE REVOKED from PUBLIC and from `anon`/`authenticated`; GRANTED to `service_role` only. Edge Function wrappers (with `agent_credentials` auth + idempotency via `agent_action_log.idempotency_key`) land in a separate ticket once POL-112 has shipped `agent_action_log`.
    3. `fix_get_daily_closure_brief_row_to_jsonb` (20260509075243; local file `20260509083500_fix_get_daily_closure_brief_row_to_jsonb.sql`): same-session hotfix — `row_to_jsonb(record)` failed inside the SECURITY DEFINER function with `SET search_path`, replaced the oldest-5 row construction with explicit `jsonb_build_object` so it is type-safe and search_path-independent.
    4. `fix_resume_closure_sla_clock_timestamp` (20260509075436; local file `20260509084000_fix_resume_closure_sla_clock_timestamp.sql`): same-session hotfix — `resume_closure_sla` used `NOW()` (= transaction-start time) for `pause_ended_at` and the elapsed-seconds calculation. Within a single transaction that always evaluates to zero seconds; in long-running transactions in production it under-counts. Replaced with `clock_timestamp()` (real wall-clock time) for both. Discovered via the in-session functional smoke (pause + `pg_sleep(2)` + resume returned 0 seconds).
    5. Verified with MCP `list_migrations`: production history now ends at `20260509075436 fix_resume_closure_sla_clock_timestamp`, with all three POL-109 migrations applied in order.
    6. Verified with MCP SQL: all 10 functions exist (`_closure_log_activity`, `register_closure_item`, `record_closure_observation`, `assign_closure_item`, `set_closure_status`, `pause_closure_sla`, `resume_closure_sla`, `close_closure_item`, `escalate_due_closure_items`, `get_daily_closure_brief`) with the expected return types and the correct GRANTs (postgres + service_role; NOT anon, NOT authenticated).
    7. Verified with MCP `get_advisors` (security): zero advisor findings reference any of the 10 new functions.
    8. Functional smoke test (full DO block, ROLLBACK-safe via transactional cleanup) confirmed end-to-end: register (new + idempotent re-register returns same id), record_observation, assign, set_closure_status (open→in_progress), pause + `pg_sleep(2)` + resume (correctly captured `total_paused_seconds=2`), get_daily_closure_brief (returned correct shape: total_open / by_severity / by_status / oldest array), close_closure_item with required note, rejection paths fired correctly (`already terminal`, `closure_note is required`). Smoke data deleted post-test (zero residue confirmed).
    9. POL-110 (`closure_items_queue` view) and POL-111 (bridge from `job_work_pool_exceptions`) all depend on this and ship next.
  - Current batch (2026-05-09, Claude Code) — POL-108 (closure engine, sub-issue b of 5 for POL-100):
    1. `closure_pauses_and_escalations` (20260509054721; local file `20260509073000_closure_pauses_and_escalations.sql`): created the two satellite closure-engine tables — `public.closure_item_sla_pauses` (11 cols, 3 indexes including the partial `closure_item_sla_pauses_open_idx` on `(org_id, closure_item_id) WHERE pause_ended_at IS NULL` for finding the currently-active pause, plus a history index) and `public.closure_escalation_events` (10 cols, 3 indexes, append-only, target_type CHECK over 4 values).
    2. Both tables FK to `closure_items.id` with `ON DELETE CASCADE`. `closure_item_sla_pauses` has a defensive CHECK that `pause_ended_at >= pause_started_at` when the end is set.
    3. RLS enabled on both. `closure_item_sla_pauses` has SELECT/INSERT/UPDATE policies via `public.is_org_member(org_id)` (no DELETE — pauses cascade with parent only). `closure_escalation_events` has SELECT/INSERT only (immutable audit trail).
    4. Verified with MCP `list_migrations`: production history now ends at `20260509054721 closure_pauses_and_escalations`.
    5. Verified with MCP SQL: `closure_item_sla_pauses` has 11 columns / 3 indexes / RLS enabled / 3 policies; `closure_escalation_events` has 10 columns / 3 indexes / RLS enabled / 2 policies.
    6. Verified with MCP `get_advisors` (security): zero advisor findings reference either new table.
    7. Cross-org-read smoke: anon `SELECT count(*) FROM closure_item_sla_pauses` and `SELECT count(*) FROM closure_escalation_events` both return 0 rows.
    8. POL-109 (RPC API surface) and POL-110 (queue view) and POL-111 (bridge from job_work_pool_exceptions) all depend on this and ship next.
  - Current batch (2026-05-08, Claude Code) — POL-107 (closure engine, sub-issue a of 5 for POL-100):
    1. `closure_items_and_activity` (20260508193251; local file `20260508193000_closure_items_and_activity.sql`): created the two core closure-engine tables — `public.closure_items` (37 cols, 5 indexes including the load-bearing partial-unique `closure_items_active_unique_source` on `(org_id, source_type, source_fingerprint) WHERE status NOT IN ('closed','cancelled')`) and `public.closure_item_activity` (9 cols, append-only, 16-event-type CHECK).
    2. RLS enabled on both; org-member SELECT/INSERT/UPDATE/DELETE policies on `closure_items` via `public.is_org_member(org_id)`; SELECT/INSERT only on `closure_item_activity` (immutable audit trail). Trigger `closure_items_set_updated_at` wired to `public.set_updated_at()`.
    3. Verified with MCP `list_migrations`: production history now ends at `20260508193251 closure_items_and_activity`.
    4. Verified with MCP SQL: `closure_items` has 37 columns / 5 indexes / RLS enabled / 4 policies; `closure_item_activity` has 9 columns / 2 indexes / RLS enabled / 2 policies.
    5. Verified with MCP `get_advisors` (security): zero advisor findings reference either new table — no `rls_disabled_in_public`, no `rls_policy_always_true`, no broken FKs.
    6. Cross-org-read smoke: anon `SELECT count(*) FROM closure_items` returns 0 rows; anon INSERT attempt (DO block with `SET LOCAL ROLE anon`) does not leave rows behind (post-smoke count = 0).
    7. Migration is purely additive — no existing tables / views / functions modified. POL-108 (sla_pauses + escalation_events), POL-109 (RPC API), POL-110 (queue view), POL-111 (bridge) all depend on this and ship next.
  - Current batch (2026-05-05, Codex):
    1. `stock_issuance_reversal_transaction_type` (20260505123946 via Supabase app connector; local file `20260505123946_stock_issuance_reversal_transaction_type.sql`): added/ensured the `REVERSAL` transaction type, reclassified existing rows linked from `stock_issuance_reversals`, and replaced `reverse_stock_issuance(...)` so future reversal stock-in rows are categorized as `REVERSAL` rather than `PURCHASE`.
    2. Verification: MCP `list_migrations` reports `20260505123946 stock_issuance_reversal_transaction_type`; issuance `2618` reversal transaction now joins to `transaction_types.type_name = 'REVERSAL'` with quantity `9`.
  - Current batch (2026-05-05, Codex):
    1. `stock_issuance_rpc_revoke_anon_execute` (20260505115516 via Supabase app connector; local file `20260505115516_stock_issuance_rpc_revoke_anon_execute.sql`): revoked default `PUBLIC`/`anon` execute from stock issuance RPCs and re-granted execute to `authenticated` and `service_role`.
    2. Verification: MCP `list_migrations` reports `20260505115516 stock_issuance_rpc_revoke_anon_execute`; privilege inspection shows `anon_can_execute = false` and `authenticated_can_execute = true` for `get_manual_stock_issuance_history`, `process_manual_stock_issuance`, both `process_stock_issuance` overloads, and `reverse_stock_issuance`.
  - Current batch (2026-05-05, Codex):
    1. `manual_issuance_history_remaining_rpc` (20260505114817 via Supabase app connector; local file `20260505114817_manual_issuance_history_remaining_rpc.sql`): added `get_manual_stock_issuance_history(p_limit)` so the browser can render manual issuance history with reversal totals applied without direct access to `stock_issuance_reversals`.
    2. Verification: MCP `list_migrations` reports `20260505114817 manual_issuance_history_remaining_rpc`; `get_manual_stock_issuance_history(20)` excludes fully reversed issuance `2618` and returns active `RIH 400mm ` issuance `2622` with `quantity_remaining = 3`.
  - Current batch (2026-05-05, Codex):
    1. `stock_issuance_reversal_ledger` (20260505113356 via Supabase app connector; local file `20260505113356_stock_issuance_reversal_ledger.sql`): added `stock_issuance_reversals` with RLS enabled and no direct anon/authenticated grants, then replaced `reverse_stock_issuance(...)` so every successful reversal writes a ledger row and future reversals are capped at issued quantity minus existing ledger rows.
    2. Verification: MCP `list_migrations` reports `20260505113356 stock_issuance_reversal_ledger`; `stock_issuance_reversals` exists; before user validation, issuance `2618` had `0` reversal rows and `0` reversed quantity.
    3. Non-mutating RPC check: `reverse_stock_issuance(2618, 10, 'Codex non-mutating verification after reversal ledger')` returned `success=false` with "Cannot reverse 10 units: only 9 remain unreversed from 9 issued", proving the row resolves and the remaining-quantity guard is active. `RIH 400mm ` quantity on hand remained `532` during this verification.
  - Current batch (2026-05-05, Codex):
    1. `manual_issuance_reversal_transaction_link` (20260505112607 via Supabase app connector; local file `20260505112607_manual_issuance_reversal_transaction_link.sql`): replaced `process_manual_stock_issuance(...)` so new manual issuance rows persist the generated `inventory_transactions.transaction_id` on `stock_issuances.transaction_id`, and replaced `reverse_stock_issuance(...)` so reversal lookup is based on `stock_issuances.issuance_id` rather than an inner join to `inventory_transactions`.
    2. Pre-fix evidence: live `stock_issuances.issuance_id = 2618` for `RIH 400mm ` existed with `transaction_id = NULL`, `quantity_issued = 9`, `external_reference = PO13627`, and `order_id = NULL`, which made the old inner join return "Issuance 2618 not found".
    3. Verification: MCP `list_migrations` reports `20260505112607 manual_issuance_reversal_transaction_link`; live function inspection shows `reverse_stock_issuance(...)` no longer contains `JOIN inventory_transactions`, and `process_manual_stock_issuance(...)` now writes `stock_issuances.transaction_id`.
    4. Non-mutating RPC check: `reverse_stock_issuance(2618, 10, 'Codex non-mutating verification')` returned `success=false` with "Cannot reverse 10 units: only 9 were issued" instead of "not found", proving the legacy row resolves without creating a reversal transaction. `RIH 400mm ` quantity on hand remained `535` during verification.
    5. Security advisors were run after apply. Findings remain the broad pre-existing RLS-disabled/security-definer/function-search-path warnings; the authenticated `SECURITY DEFINER` warnings for the stock issuance RPCs are unchanged/intentional for the current browser-callable workflow.
  - Previous batch (2026-04-28, Codex):
    1. `supplier_order_balance_closures` (20260428120545; local file `20260428120545_supplier_order_balance_closures.sql`): added `supplier_orders.closed_quantity`, non-negative and received-plus-closed quantity guards, balance-closure ledger tables, select-only org-member RLS for the ledger, and the `close_supplier_order_balance(...)` RPC for audited closure of partially received line balances.
    2. Verified with Supabase MCP `list_migrations`; production history reports `20260428120545 supplier_order_balance_closures`.
    3. Verified with targeted MCP SQL: PO `Q26-395` supplier order `643` has `22` ordered, `17` received, `0` closed, and `5` outstanding before user action; no closure ledger rows exist yet for that line. The new over-receipt guard is present on `supplier_orders`, and the new ledger tables expose only SELECT policies to authenticated org members.
  - Current batch (2026-03-30, Codex):
    1. `fix_timekeeper_summary_null_buckets` (20260330083217): hardened `before_insert_or_update_time_daily_summary()` to coalesce missing totals to zero instead of deriving `NULL` payroll buckets, and updated `update_daily_work_summary()` so legacy timekeeper inserts/upserts carry safe minute totals/break totals while keeping Sunday rows in the double-time bucket only.
    2. Verified with MCP `list_migrations`: production history now includes `20260330083217`.
    3. Verified with MCP SQL: the live `before_insert_or_update_time_daily_summary()` function now clamps null `total_work_minutes` to `0` and writes `regular_minutes = 0`, `ot_minutes = 0`, `dt_minutes = 0` for a rolled-back Sunday placeholder summary insert instead of failing the `dt_minutes` NOT NULL constraint.
  - Current batch (2026-03-19, Codex):
    1. `factory_floor_issued_progress_zero` (20260319065606): updated `public.factory_floor_status` so `issued` jobs remain visible on the floor but stay at `0%` progress until work is actually started; only `in_progress` and `on_hold` assignments accrue elapsed minutes and auto progress.
    2. Verified with MCP `list_migrations`: production history now includes `20260319065606`.
    3. Verified with MCP SQL: `TEST-LC-002` assignments `74`, `75`, and `76` now all report `minutes_elapsed = 0` and `auto_progress = 0` while still in `issued` status with `started_at = null`.
  - Current batch (2026-03-19, Codex):
    1. `factory_floor_parent_category_routing` (20260319062333): updated `public.factory_floor_status` so floor routing follows the top-level job category, allowing subcategories like `Brackets` to inherit the `Steel Work` section; also tightened the job-card lookup to the exact card encoded in `job_instance_id` to avoid duplicate floor rows.
    2. Verified with MCP `list_migrations`: production history now includes `20260319062333`.
    3. Verified with MCP SQL: `TEST-LC-002` assignments `74` and `76` (`Brackets`) now resolve to `Steel Section`, while assignment `75` (`Powder Coating`) resolves to `Powder Coating`.
    4. Verified with MCP SQL: each assignment resolves to its own `job_card_id` (`34`, `35`, `36`) with no duplicate floor rows.
  - Current batch (2026-03-19, Codex):
    1. `sync_issued_scheduler_assignments` (20260319060032): backfilled card-backed `labor_plan_assignments` rows that were missing lifecycle state, and updated `public.assign_scheduled_card(...)` so issued scheduler assignments persist `job_status = 'issued'` plus `issued_at` for factory-floor visibility.
    2. Verified with MCP `list_migrations`: production history now includes `20260319060032`.
    3. Verified with MCP SQL: `TEST-LC-002` assignment rows `74`, `75`, and `76` now all report `job_status = 'issued'` with populated `issued_at`.
    4. Verified with MCP SQL at the time of apply: `factory_floor_status` returned the issued `Powder Coating` assignment for `TEST-LC-002`; the follow-up parent-category routing migration below then resolved the two `Brackets` assignments into `Steel Section`.
  - Current batch (2026-03-12, Codex):
    1. `add_payroll_standard_week_hours` (20260312154218): added `public.organizations.payroll_standard_week_hours` as org-scoped payroll configuration for the weekly regular-hours cutoff, defaulting existing organizations to `44.00`.
    2. Verified with MCP `list_migrations`: production history now includes `20260312154218`.
    3. Verified with MCP SQL: `public.organizations.payroll_standard_week_hours` exists and `QButton` currently reads `44.00`.
  - Current batch (2026-03-11, Codex):
    1. `piecework_completion_payroll_phase1b` (20260311073942): added `assign_scheduled_card` so first-time scheduling of an issued card updates `job_cards.staff_id` atomically with `labor_plan_assignments`, closing the initial scheduler/payroll ownership gap.
    2. Verified with MCP `list_migrations`: production history now includes `20260311073942`.
    3. Verified with MCP SQL: `public.assign_scheduled_card(...)` exists in `public`.
  - Current batch (2026-03-11, Codex):
    1. `reconcile_complete_assignment_with_card_rpc` (20260311072949): reconciled the live `complete_assignment_with_card` RPC into tracked migration history so repo state matches the production database.
    2. `piecework_completion_payroll_phase1` (20260311073315): added payroll-safe completion metadata on `job_cards`, explicit remainder metadata on `job_card_items`, the `complete_job_card_v2`, `complete_assignment_with_card_v2`, `reassign_scheduled_card`, `extract_job_card_id_from_instance`, and `is_job_card_payroll_locked` RPC/functions, plus updated `job_work_pool_status` math for returned/follow-up remainders.
    3. Verified with MCP `list_migrations`: production history now includes `20260311072949` and `20260311073315`.
    4. Verified with MCP SQL: new `job_cards` columns (`completed_by_user_id`, `completion_type`), new `job_card_items` columns (`remainder_action`, `remainder_qty`, `remainder_reason`, `remainder_follow_up_card_id`, `issued_quantity_snapshot`), and the new completion/reassignment functions all exist in `public`.
  - Current batch (2026-03-08, Codex):
    1. `organization_cutlist_defaults` (20260308102326): added `public.organizations.cutlist_defaults` as nullable `jsonb` for org-specific reusable offcut thresholds.
    2. Verified with MCP `list_migrations`: production history now includes `20260308102326`.
    3. Verified with MCP SQL: `public.organizations.cutlist_defaults` exists as nullable `jsonb`.
  - Current batch (2026-03-11, Codex):
    1. `fractional_purchase_receipts` (20260311141133): converted `supplier_order_receipts.quantity_received`, `inventory_transactions.quantity`, and `inventory.quantity_on_hand` to `numeric`; recreated dependent inventory views/materialized view; and replaced `process_supplier_order_receipt` with the decimal-safe org-aware signature.
    2. Verified with MCP `list_migrations`: production history now includes `20260311141133`.
    3. Verified with MCP SQL: the three quantity columns now report `numeric` in `information_schema.columns`.
    4. Verified with MCP SQL: only the numeric `process_supplier_order_receipt` signature remains in `public`.
  - Current batch (2026-03-06, Codex):
    1. `purchase_order_shared_drafts` (20260306161654): added `purchase_order_drafts` and `purchase_order_draft_lines`, org-scoped RLS using `organization_members`, autosave/status RPCs, and updated `create_purchase_order_with_lines` to stamp `created_by = auth.uid()`.
    2. Verified with MCP `list_migrations`: production history now includes `20260306161654`.
    3. Verified with MCP table inspection: `public.purchase_order_drafts` and `public.purchase_order_draft_lines` both exist with RLS enabled.
    4. Verified with MCP SQL: `public.save_purchase_order_draft`, `public.set_purchase_order_draft_status`, and `public.create_purchase_order_with_lines` all exist in the `public` schema.
  - Current batch (2026-03-06, Codex):
    1. `create_job_work_pool` (20260305195332): added `job_work_pool`, `job_work_pool_status`, `job_work_pool_exceptions`, `job_work_pool_exception_activity`, and `job_card_items.work_pool_id` with org-scoped RLS on the new pool/exception tables.
    2. `work_pool_exception_rpcs` (20260306100303): added `reconcile_work_pool_row`, `acknowledge_work_pool_exception`, and `resolve_work_pool_exception` RPCs for audit-compliant exception transitions.
    3. `work_pool_exception_rpcs_v2` (20260306100805): hardened the new RPCs with `is_org_member()` checks, non-negative reconciliation validation, and simplified resolve audit output to a single terminal event.
    4. Verified with MCP `list_migrations`: production history includes `20260305195332`, `20260306100303`, and `20260306100805`.
    5. Verified with MCP SQL: `public.reconcile_work_pool_row`, `public.acknowledge_work_pool_exception`, and `public.resolve_work_pool_exception` all exist in the `public` schema.
  - Current batch (2026-03-03, Codex):
    1. Verified with MCP SQL: `public.product_images.crop_params` exists as nullable `jsonb`.
    2. Verified live row shape for product `826`: uploaded image records now persist `crop_params` metadata separately from `image_url`, enabling non-destructive crop reset behavior once the UI saves against the real `image_id`.
  - Previous batch (2026-02-25, Codex):
    1. `timekeeper_anon_read_hotfix_qbutton` (20260225073626): restored limited `anon` read on `public.staff` + `public.time_clock_events` for active Qbutton staff.
    2. `timekeeper_anon_insert_policy_fix` (20260225074120): relaxed `anon` insert policy predicate to work with scanner payload shape.
    3. `timekeeper_anon_policy_uuid_lock_fix` (20260225074246): removed `organizations` table dependency from anon policy checks and locked predicates to Qbutton org UUID.
    4. `timekeeper_trigger_security_definer_fix` (20260225074503): made `update_daily_work_summary` trigger function `SECURITY DEFINER` and propagated `org_id` in summary upserts.
    5. External scanner behavior verified via real anon REST calls.
  - Reconciliation note (2026-03-07, Codex):
    1. Verified with Supabase MCP `list_migrations` that production history includes `20260225065251_add_overhead_line_type_to_quote_clusters`.
    2. Reconciled local repo drift by adding the missing canonical file `supabase/migrations/20260225065251_add_overhead_line_type_to_quote_clusters.sql`.
    3. No production apply was performed on 2026-03-07; this was a local migration-history reconciliation only.
  - Current batch (2026-02-26, Claude Code):
    1. `per_allocation_receipt_phase_a` (20260226075243): added `received_quantity` column to `supplier_order_customer_orders`, 4-arg `process_supplier_order_receipt` overload with allocation-aware tracking, org auth via `is_org_member()`, 3-arg backward-compatible wrapper.
    2. `block_reallocation_after_receipts` (20260226075254): updated `update_supplier_order_allocations` to block reallocation when any allocation has `received_quantity > 0`.
    3. Verified: both function overloads exist with correct signatures, `received_quantity` column is nullable numeric.
  - Current batch (2026-02-26, Codex):
    1. `drop_receipt_rpc_3arg_wrapper` (20260226091236): removed legacy 3-arg wrapper overload now that the 4-arg `process_supplier_order_receipt` signature is established.
    2. `stocked_subassembly_tenancy_expand` (20260226145912): added/backfilled `org_id` for `product_bom_links` and `billoflabour`, plus related index/FK/consistency trigger setup.
    3. `stocked_subassembly_tenancy_enforce_rls` (20260226145953): validated/enforced constraints and enabled org-scoped RLS/policies on `product_bom_links`, `billoflabour`, and `billofmaterials`.
    4. Verified with MCP SQL: `product_bom_links.org_id` and `billoflabour.org_id` are `NOT NULL`, and RLS is enabled with org-member policies.
    5. Verified in UI smoke (`/products/782` as normal user): `/api/products/782/effective-bom` and `/api/products/782/effective-bol` now return `200`.
  - Current batch (2026-03-03, Codex):
    1. `backfill_open_underallocated_supplier_order_stock_rows` (20260303145040): added missing stock allocation remainder for legacy open supplier-order lines where allocation rows existed but summed below `supplier_orders.order_quantity`.
    2. Verified with MCP SQL: only `Q26-184` matched the open under-allocated shape before the backfill; after apply, its supplier order `269` has allocation totals equal to line quantity (`2` for order `24608`, `1` for stock), unblocking receipt of the final unit.
  - Component reservations batch (2026-03-03, Claude Code):
    1. `component_reservations_table` (20260303085534): `component_reservations` table with RLS and unique constraint on `(order_id, component_id)`.
    2. `component_reservation_rpcs` (20260303085548): `reserve_order_components` and `release_order_components` RPCs.
    3. `fix_component_reservation_rpc_ambiguity` (20260303085611): no-op (fix folded into RPCs file).
    4. `extend_component_status_with_reservations_v2` (20260303085711): added `reserved_this_order` and `reserved_by_others` columns to `get_detailed_component_status` return type.
    5. `auto_release_component_reservations_trigger` (20260303085743): auto-delete reservations when order moves to Completed/Cancelled.
    6. `fix_shortfall_math_reservation_aware` (20260303144322): per-order shortfall formulas now use `in_stock - reserved_by_others` as available stock.
    7. `component_reservations_rls_and_indexes` (20260303151451): replaced `profiles.org_id` RLS with standard `organization_members` pattern; added indexes on `order_id`, `component_id`, `org_id`.
    8. Verified: RLS enabled, security advisors clean, no missing-policy warnings.
  - Phase B enforcement (`per_allocation_receipt_phase_b`) is staged locally but NOT yet applied — will be applied after UI deploy and production verification of split receipts.

## Pre-Deploy Migration Checklist
- [x] Repo checked: latest file in `supabase/migrations`
- [x] Target env checked: latest applied from MCP `list_migrations`
- [x] Any pending migrations applied in target env
- [x] Post-apply verification completed
- [x] This document updated
