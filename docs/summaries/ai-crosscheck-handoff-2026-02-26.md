# AI Cross-Check Handoff

Date: 2026-02-26  
Project: Unity ERP

## 0) Delta Since Last Cross-Check

1. Closed the optional-org edge case in effective BOM resolver:
- `resolveEffectiveBom(...)` now requires `orgId` and throws if missing.
- `product_bom_links` query now always filters by `.eq('org_id', orgId)` (no conditional fallback path).
2. Updated resolver unit test callers to pass required `orgId` argument.
3. Re-ran `npm run build` after this change; build still passes.

## 1) Locked Product Decisions (A-G)

1. Default behavior for reusable manufactured children is non-exploded/stocked attachment in parent workflows.
2. Quote costing stays rolled-up (no quote-time explosion), with drill-down to child product.
3. Shortage defaults by supply type:
- Manufactured -> Build
- Purchased -> Buy
- Hybrid -> Build (default)
4. Split fulfillment is allowed (stock + build, rare manual buy-out exception).
5. MTO child build jobs must link to parent order.
6. MTS replenishment uses reorder minimum + target level guidance; user confirms final quantity.
7. Child job cards require manual confirmation.
8. Child labor counts only when child is build-now (no double counting when pulled from stock).
9. Orders UI target model: 3 buckets (Buy / Pull / Build).
10. Cutlist excludes pulled-from-stock linked children by default.
11. Requirements definition is snapshotted per order; stock allocation remains live/reassignable with audit trail.
12. Safety rules: where-used warning required; link-mode changes with open orders require controlled path (warning/override/revision behavior).
13. Recursion default = depth 5 + mandatory cycle guard.

## 2) Main Workstreams

### Workstream A: PO Per-Allocation Receipt Tracking

Status: Phase A + reallocation guard applied in production (2026-02-26); Phase B enforcement not yet applied.

Files touched:
- `/Users/gregorymaier/Developer/unity-erp/supabase/migrations/20260226075243_per_allocation_receipt_phase_a.sql`
- `/Users/gregorymaier/Developer/unity-erp/supabase/migrations/20260226075254_block_reallocation_after_receipts.sql`
- `/Users/gregorymaier/Developer/unity-erp/supabase/migrations/20260226075300_per_allocation_receipt_phase_b.sql`
- `/Users/gregorymaier/Developer/unity-erp/app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx`
- `/Users/gregorymaier/Developer/unity-erp/app/purchasing/purchase-orders/[id]/BulkReceiveModal.tsx`
- `/Users/gregorymaier/Developer/unity-erp/app/purchasing/purchase-orders/[id]/page.tsx`
- `/Users/gregorymaier/Developer/unity-erp/components/features/orders/ProcurementTab.tsx`
- `/Users/gregorymaier/Developer/unity-erp/types/purchasing.ts`

Implementation notes:
- Adds `received_quantity` allocation-level tracking.
- Adds 4-arg receipt RPC with `p_allocation_receipts jsonb` and keeps 3-arg compatibility wrapper.
- Includes split-line validation, caps, org check (`is_org_member` with service-role bypass), phase-A mixed-tracking guard, and phase-B split enforcement.
- UI modals now collect allocation breakdown for split lines.
- Procurement tab uses `received_quantity` when present, fallback to legacy capped logic when null.

### Workstream B: Stocked Sub-Assembly Policy + Phase-1 Tenancy Hardening

Status: Policy + docs finalized; tenancy migrations applied in production; auth-propagation fixes implemented for effective endpoint callers.

Policy/docs:
- `/Users/gregorymaier/Developer/unity-erp/docs/plans/stocked-subassembly-policy-spec-v1.md`
- `/Users/gregorymaier/Developer/unity-erp/docs/plans/stocked-subassembly-manufacturing-plan.md`
- `/Users/gregorymaier/Developer/unity-erp/docs/overview/todo-index.md`

New migrations:
- `/Users/gregorymaier/Developer/unity-erp/supabase/migrations/20260226145912_stocked_subassembly_tenancy_expand.sql`
- `/Users/gregorymaier/Developer/unity-erp/supabase/migrations/20260226145953_stocked_subassembly_tenancy_enforce_rls.sql`

API hardening:
- `/Users/gregorymaier/Developer/unity-erp/app/api/products/[productId]/bom/attach-product/route.ts`
- `/Users/gregorymaier/Developer/unity-erp/app/api/products/[productId]/bom/apply-product/route.ts`
- `/Users/gregorymaier/Developer/unity-erp/app/api/products/[productId]/effective-bom/route.ts`
- `/Users/gregorymaier/Developer/unity-erp/app/api/products/[productId]/effective-bol/route.ts`

Implementation notes:
- Adds module/org access checks via `requireModuleAccess` for targeted product routes.
- Adds org-bound filtering for effective BOM/BOL and attach/apply actions.
- Expand migration adds `org_id` to `product_bom_links` and `billoflabour`, backfills from parent product, and creates consistency triggers.
- Enforce migration validates FK, enforces NOT NULL, enables RLS policies for `product_bom_links` and `billoflabour`, and replaces broad `billofmaterials` policy with org-member policies.
- Client-side effective endpoint callsites now use authenticated fetch (`Authorization: Bearer <token>`) in product costing/BOM/BOL/cutlist and quote costing helpers.
- Phase naming alignment note added so policy “Phase 1” maps to implementation plan phases 1-4.

## 3) What Is NOT Done Yet

1. `per_allocation_receipt_phase_b` (`20260226075300`) is not applied yet (intentionally staged after UI verification).
2. Stocked-mode behavior changes (`mode='stocked'` support and resolver behavior) are not yet implemented in routes/UI.
3. Reservations/reallocation execution flow (audit ledger + reopen shortages) is policy-locked but not implemented yet.

## 4) Validation Results

1. `npm run build` passes after changes.
2. `npx tsc --noEmit` still reports pre-existing repo-wide errors unrelated to this slice.
3. DB verification (via Supabase MCP):
- Receipt tracking state (production):
  - Applied: `20260226075243_per_allocation_receipt_phase_a`, `20260226075254_block_reallocation_after_receipts`
  - Applied: `20260226091236_drop_receipt_rpc_3arg_wrapper`
  - Not yet applied: `20260226075300_per_allocation_receipt_phase_b`
  - Verified live: only the 4-arg `process_supplier_order_receipt(p_order_id, p_quantity, p_receipt_date, p_allocation_receipts)` signature remains; function is `SECURITY DEFINER`, `search_path=public`, and `received_quantity` remains nullable.
- Stocked-subassembly tenancy state (production, post-apply):
  - Applied: `20260226145912_stocked_subassembly_tenancy_expand`, `20260226145953_stocked_subassembly_tenancy_enforce_rls`.
  - Verified live: `product_bom_links.org_id` and `billoflabour.org_id` exist as `uuid NOT NULL`.
  - Verified live: RLS enabled on `product_bom_links`, `billoflabour`, and `billofmaterials` with org-member policies.
4. Follow-up authenticated smoke (testai user) completed:
  - UI BOM writes succeeded as normal org user: component add + delete both worked on `/products/782` Costing tab; test row cleaned up (`billofmaterials` rows for product 782 returned to 0).
  - Effective endpoint path now healthy: `/api/products/782/effective-bom` and `/api/products/782/effective-bol` return `200` in the Costing flow.

## 5) Critical Apply/Deploy Order

### A) Per-allocation receipts
1. Confirm UI/API split-receiving changes are deployed.
2. Validate split receiving paths against live Phase A behavior.
3. Apply `20260226075300_per_allocation_receipt_phase_b.sql` (enforcement step).

### B) Stocked sub-assembly tenancy hardening
1. Applied: `20260226145912_stocked_subassembly_tenancy_expand.sql`
2. Applied: `20260226145953_stocked_subassembly_tenancy_enforce_rls.sql`
3. Implemented: effective endpoint callers now send bearer auth.
4. Re-run normal-user smoke tests on Products BOM/BOL/effective endpoints after each deploy.

## 6) Cross-Check Checklist For Second AI

1. Verify migration SQL is additive and ordered correctly (expand before enforce).
2. Verify no cross-org leakage remains in touched product API routes.
3. Verify service-role paths are not unintentionally blocked in receipt RPC (phase A/B).
4. Verify `billofmaterials` policy replacement does not break legit authenticated product BOM writes.
5. Verify deployment ordering notes are reflected in final execution plan.
6. Verify migration ledger update step is included after apply (`docs/operations/migration-status.md`).

## 7) Current Branch/Workspace Reality

1. Worktree is dirty with other unrelated edits; do not reset/revert unrelated files.
2. New migration files and plan files are currently uncommitted.
