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
- Latest applied migration version: 20260226145953
- Latest applied migration name: stocked_subassembly_tenancy_enforce_rls
- Applied at (UTC): 2026-02-26 15:08:36 UTC
- Applied by: Codex via Supabase MCP
- Verification notes:
  - Previous batch (2026-02-25, Codex):
    1. `timekeeper_anon_read_hotfix_qbutton` (20260225073626): restored limited `anon` read on `public.staff` + `public.time_clock_events` for active Qbutton staff.
    2. `timekeeper_anon_insert_policy_fix` (20260225074120): relaxed `anon` insert policy predicate to work with scanner payload shape.
    3. `timekeeper_anon_policy_uuid_lock_fix` (20260225074246): removed `organizations` table dependency from anon policy checks and locked predicates to Qbutton org UUID.
    4. `timekeeper_trigger_security_definer_fix` (20260225074503): made `update_daily_work_summary` trigger function `SECURITY DEFINER` and propagated `org_id` in summary upserts.
    5. External scanner behavior verified via real anon REST calls.
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
  - Phase B enforcement (`per_allocation_receipt_phase_b`) is staged locally but NOT yet applied — will be applied after UI deploy and production verification of split receipts.

## Pre-Deploy Migration Checklist
- [ ] Repo checked: latest file in `supabase/migrations`
- [ ] Target env checked: latest applied from MCP `list_migrations`
- [ ] Any pending migrations applied in target env
- [ ] Post-apply verification completed
- [ ] This document updated
