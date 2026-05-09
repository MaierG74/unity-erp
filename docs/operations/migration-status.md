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
- Latest applied migration version: 20260509054721
- Latest applied migration name: closure_pauses_and_escalations
- Applied at (UTC): 2026-05-09 05:47 UTC
- Applied by: Claude Code via Supabase MCP for Unity production (`ttlyfhkrsjjrzxiagzpb`)
- Verification notes:
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
