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
- Latest applied migration version: 20260428163007
- Latest applied migration name: inventory_average_cost_recompute_rpc
- Applied at (UTC): 2026-04-28 16:30 UTC
- Applied by: Codex via Supabase MCP namespace `supabase_kinetic` (POL-69; primary `supabase` namespace returned unauthorized)
- Verification notes:
  - Current batch (2026-04-28, Codex / POL-69):
    1. `inventory_average_cost_columns` (20260428162848 via Supabase MCP; local file `20260428162300_inventory_average_cost_columns.sql`): added nullable `public.inventory_transactions.unit_cost numeric(18,6)` and `public.inventory.average_cost numeric(18,6)`, refreshed `inventory_transactions_enriched`, `v_inventory_with_components`, and `v_inventory_shortages` so the new columns are not hidden by view drift.
    2. `inventory_average_cost_receipt_rpc` (20260428162943 via Supabase MCP; local file `20260428162400_inventory_average_cost_receipt_rpc.sql`): replaced the live nine-parameter `process_supplier_order_receipt` with the WAC-aware version, preserving the signature, stamping `org_id` explicitly on receipt/return transaction writes, writing `unit_cost` only for positive priced purchase quantities, and updating `inventory.average_cost` through a single `INSERT ... ON CONFLICT (component_id) DO UPDATE`.
    3. `inventory_average_cost_recompute_rpc` (20260428163007 via Supabase MCP; local file `20260428162500_inventory_average_cost_recompute_rpc.sql`): added `recompute_inventory_average_cost_from_history(p_org_id uuid, p_component_id int default null)` with `set search_path = public` and atomically restricted EXECUTE to `service_role` by revoking from `public`, `anon`, and `authenticated` in the same migration file.
    4. Reconciliation: MCP `list_migrations` was run after each apply; production history now reports all three POL-69 migrations. The grant check after A3 showed `authenticated_has_execute=false`, `anon_has_execute=false`, and non-owner EXECUTE grantees `{service_role}`; PostgreSQL also reports owner `postgres`, which is expected owner privilege and not a client-callable grant.
    5. Guardrail: the seed script was added but not run against production in this apply batch; Greg approval is required before running `npx tsx scripts/seed-inventory-average-cost.ts` or the safer scoped form `npx tsx scripts/seed-inventory-average-cost.ts --org-id <QButton-org-id>`.
  - Current batch (2026-04-27, Codex / POL-63):
    1. `piecework_completion_earnings_reopen` (20260427205302; local file `20260427205302_piecework_completion_earnings_reopen.sql`): added the explicit `staff_piecework_earning_entries` ledger, preserved the existing `staff_piecework_earnings` reader shape with an insert-trigger-backed view, added `complete_piecework_assignment(...)`, and added `reopen_piecework_job_card(...)` with negating earnings rows.
    2. Discovery evidence before writing/apply: production `staff_piecework_earnings` is a view, not a base table; its nullable `item_id`, `job_id`, and `product_id` columns remain present for cut/edge cards; `job_cards` already has nullable `piecework_activity_id`, `expected_count`, `actual_count`, and `rate_snapshot`.
    3. Verified with Supabase MCP `list_migrations`; production history reports `20260427205302 piecework_completion_earnings_reopen`.
  - Current batch (2026-04-27, Claude follow-up to POL-62):
    1. `extend_job_work_pool_status_view` (20260427183852 via Supabase MCP; local file `20260427201500_extend_job_work_pool_status_view.sql`): updated `public.job_work_pool_status` to expose the four columns added by `piecework_foundation` (`piecework_activity_id`, `material_color_label`, `expected_count`, `cutting_plan_run_id`). Reviewer browser-smoke against `PUT /api/orders/<id>/cutting-plan` had 500'd with `42703 column job_work_pool_status.piecework_activity_id does not exist` because POL-60 added the columns to the base table only and did not propagate them to the view. Columns appended (not reordered) per Postgres `CREATE OR REPLACE VIEW` rules.
    2. Verified with Supabase MCP `list_migrations` and `information_schema.columns` after apply; the four new columns are present on the view.
  - Current batch (2026-04-27, Codex):
    1. `cutting_plan_piecework_pool_idempotency` (20260427181610 via Supabase MCP; local file `20260427152000_cutting_plan_piecework_pool_idempotency.sql`): added the unique partial index for active cutting-plan piecework pool rows and widened work-pool exception checks for `exception_type='cutting_plan_issued_count_changed'` and `trigger_source='cutting_plan_finalize'`.
    2. Verified with Supabase MCP migration history after apply; `list_migrations` reports `20260427181610 cutting_plan_piecework_pool_idempotency`.
  - Current batch (2026-04-27, Codex):
    1. `piecework_foundation` (20260427135000): added org-scoped `piecework_activities` and `piecework_card_adjustments`, additive nullable piecework metadata on `job_cards` and `job_work_pool`, widened `job_work_pool.source` to include `cutting_plan`, and seeded QButton `cut_pieces`/`edge_bundles` activities.
    2. Discovery evidence before writing the migration: `job_work_pool.source` is `text` with `job_work_pool_source_check`; finalized cutting plans currently persist on `orders.cutting_plan` with `orders.order_id` as the primary key; `staff_piecework_earnings.item_id`, `job_id`, and `product_id` are already nullable.
    3. QButton seed roles resolved from live data: `Cut and Edge ` (trimmed match) is `labor_roles.role_id = 5`; `Edging` is `labor_roles.role_id = 8`.
    4. Verified with Supabase MCP migration history and targeted SQL after apply; security/performance advisor results are recorded in the POL-60 PR and Linear delivery comment.
  - Current batch (2026-04-24, Codex / Claude Code):
    1. `billoflabour_drop_flex_pay_pairing` (20260424073702): dropped the redundant `billoflabour_pay_pairing_flex_chk` CHECK constraint on `public.billoflabour`. The stricter `billoflabour_pay_pairing_chk` now solely enforces `rate_id IS NOT NULL` for hourly rows, matching how every runtime writer resolves rates via `job_category_rates`.
    2. `noop_project_probe_do_not_use` (20260424073603): empty placeholder recorded during Supabase MCP project routing verification. Contains no schema changes; committed to keep the local migrations directory aligned with the server's migration history.
    3. Precheck (MCP SQL) confirmed both `billoflabour_pay_pairing_chk` and `billoflabour_pay_pairing_flex_chk` existed with their expected definitions, and that zero hourly rows had `rate_id IS NULL` before the drop.
    4. Postcheck (MCP SQL) confirms only `billoflabour_pay_pairing_chk` remains.
    5. Ran Supabase security advisors after apply; no new findings attributable to the constraint drop.
    6. **Step-3 rollback note** — the `drop_job_categories_current_hourly_rate` migration (20260423120000, logged in the earlier batch below) was reverted in production by re-adding the column and backfilling it from `public.job_category_rates`. Reason: the migration applied via MCP hits the same Supabase project Netlify deploys to (`ttlyfhkrsjjrzxiagzpb`), but the corresponding code changes (which stop reading `current_hourly_rate`) live on `codex/integration` only, not on `main`. Production code still reads the column, so the drop caused `.toFixed` crashes on the Labor Management page. Recovery SQL (idempotent): `ALTER TABLE public.job_categories ADD COLUMN IF NOT EXISTS current_hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0;` followed by backfill from the active row in `job_category_rates`. Column is currently present in production; the step-3 migration file remains on `codex/integration` and will re-drop the column only after the step-3 UI code is deployed to `main`.
  - Previous batch (2026-04-24, Codex):
    1. `drop_job_categories_current_hourly_rate` (20260423120000): dropped the stale denormalized `public.job_categories.current_hourly_rate` column so category hourly display and costing readers resolve rates from `public.job_category_rates`. **Subsequently rolled back in production** — see the rollback note in the later 2026-04-24 batch above.
    2. Verified with MCP `list_migrations`: production history includes `20260423120000`; MCP history also shows later previously-applied migrations through `20260423134334`.
    3. Verified with MCP SQL (at apply time): `information_schema.columns` returned no `current_hourly_rate` column for `public.job_categories`.
    4. Verified with MCP SQL (at apply time): the active Quality Control category rate resolved from `job_category_rates` as `rate_id = 4`, `hourly_rate = 50.00`.
    5. Ran Supabase security advisors after apply; findings remain broad pre-existing RLS/security-definer warnings, including `job_category_rates` policy-exists/RLS-disabled, with no finding caused by the dropped column.
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
