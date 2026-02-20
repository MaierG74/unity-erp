---
title: TODO Index
last_updated: 2026-02-15
---

Unity ERP's documentation spreads TODOs and open questions across domain guides, changelogs, and technical references. Use this index as a single starting point to see what still needs attention and where the authoritative source of truth lives.

## How to Use This Index
- Scan the area that matches your current project or release scope.
- Follow the "Source" link for full context, acceptance criteria, and historical notes before making changes.
- Update the status/owner placeholders as work is planned or completed so downstream readers know who is driving each item.

## Auth
- **Roll out admin-managed user lifecycle (synthetic login, display name, avatar)** — Status: _In progress_, Owner: _Unassigned_. Implement admin endpoints/UI for create/reset/deactivate, display-name/login edits, and avatar uploads to the `avatars` bucket; enforce `is_active`/`banned_until` in RLS. Source: [user onboarding](../auth/user-onboarding.md), [admin API](../auth/admin-api.md), [Admin Users UI](../auth/ui-admin-users.md), [SQL snippets](../auth/sql-snippets.md).
- **Ship tenant-level module entitlements with platform toggle controls** — Status: _In progress_, Owner: _Unassigned_. Add `module_catalog` + per-org entitlement records, introduce platform-admin controls, and enforce module access at UI route/API layers starting with `furniture_configurator`. Source: [tenant module rollout plan](../plans/tenant-module-entitlements-rollout-plan.md), [tenant entitlements runbook](../operations/tenant-module-entitlements-runbook.md), [User Control module spec](../sales/SPEC_USER_CONTROL_MODULE.md).
- **Tenant-isolate live domain data (`orders/products/stock`) with zero downtime** — Status: _In progress (Stage 1 + Stage 2 completed in production on 2026-02-14; Stage 3 product + orders API org scoping implemented on 2026-02-15; Stage 4 constraints completed in production on 2026-02-15; Stage 5 RLS baby-step rollout completed for core scoped tables in production on 2026-02-15: `products`, `customers`, `orders`, `order_details`, `product_inventory`, `product_inventory_transactions`, `product_reservations`, `components`, `inventory`, `inventory_transactions`; Phase B expand-only `org_id` columns + backfill completed in production on 2026-02-15 for purchasing/quotes/staff tables; `suppliers` moved to org-scoped RLS on 2026-02-20 via Step 13)_, Owner: _Unassigned_. Add `org_id` columns in additive phases, backfill all existing rows to `Qbutton`, validate parent-child consistency, then enforce constraints and RLS after stable cutover. Source: [tenant data isolation runbook](../operations/tenant-data-isolation-zero-downtime-runbook.md), [tenant module rollout plan](../plans/tenant-module-entitlements-rollout-plan.md).
## Purchasing
- **Seed missing supplier order statuses** — Status: _Addressed (seeded)_, Owner: _Unassigned_. Seeds now include Approved, Partially Received, and Fully Received alongside legacy names. Verify in your DB after running setup. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Define transactional receiving RPC** — Status: _Implemented_, Owner: _Unassigned_. `process_supplier_order_receipt` RPC handles receipt insertion, inventory updates, and status recompute atomically. Frontend falls back to manual updates if RPC unavailable. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Fix purchase order receiving insert** — Status: _Resolved_, Owner: _Unassigned_. `receiveStock` now looks up the component first, omits the sales‑order FK on `inventory_transactions`, records the receipt, updates inventory on‑hand, and recomputes SO totals/status. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Purchase order auto-refresh** — Status: _Resolved_, Owner: _Unassigned_. Added query configuration (`refetchOnMount: true`, `staleTime: 0`) and `refetchQueries` calls to ensure page updates automatically after receiving stock without manual refresh. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Purchase order "Owing" column** — Status: _Resolved_, Owner: _Unassigned_. Added "Owing" column to Order Items table showing `order_quantity - total_received` with orange highlighting when > 0. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Backfill schema snapshot** — Status: _Open_, Owner: _Unassigned_. Bring `schema.txt` up to date with the `supplier_orders.purchase_order_id` relationship to prevent drift between docs and migrations. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Harden receiving validation** — Status: _In progress_, Owner: _Unassigned_. Client now blocks over‑receipts; still add server‑side checks in the RPC to prevent bypass. Source: [purchasing-known gaps](../domains/purchasing/purchasing-master.md#known-gaps--todos).
- **Implement stock issuance** — Status: _Completed_, Owner: _Unassigned_. ✅ Stock issuance functionality implemented on Order Detail page with BOM integration, PDF generation, and issuance tracking. Includes `process_stock_issuance` and `reverse_stock_issuance` RPC functions, `IssueStockTab` UI component, and `StockIssuancePDF` component. Source: [stock issuance plan](../plans/stock-issuance-plan.md), [implementation changelog](../changelogs/stock-issuance-implementation-20250104.md).
- **Implement supplier returns** — Status: _Planning_, Owner: _Unassigned_. Build functionality to return goods to suppliers, handling both immediate rejections on delivery and later returns. Requires `supplier_order_returns` table, RPC function, and UI components. Source: [supplier returns plan](../plans/supplier-returns-plan.md).

## Timekeeping
- **Ensure double-time minutes are persisted** — Status: _Open_, Owner: _Unassigned_. Update `add_manual_clock_event_v2` (and any other summary writers) so inserts/updates to `time_daily_summary` always set `dt_minutes` (default 0 for non-Sunday days) to satisfy the new NOT NULL constraint and keep manual event entry unblocked. Also backfill existing rows. Source: [time & attendance working doc](../domains/timekeeping/time-attendance-working.md#database-tables-supabase), [Sunday + double-time payroll rollout plan](../plans/sunday-doubletime-payroll-rollout-plan.md).
- **Unify Sunday/double-time payroll calculations across weekly summary and payroll pages** — Status: _Planning_, Owner: _Unassigned_. Align all consumers to a single summary source of truth (`time_daily_summary` minute buckets), dual-run old/new payroll calculations, and release behind a rollbackable feature flag. Source: [Sunday + double-time payroll rollout plan](../plans/sunday-doubletime-payroll-rollout-plan.md).
- **Add public-holiday double-time policy after Sunday rollout** — Status: _Deferred_, Owner: _Unassigned_. Keep current rollout scoped to Sunday double-time only; add policy + implementation pass for public-holiday double-time once Sunday payroll path is stable in production. Source: [Sunday + double-time payroll rollout plan](../plans/sunday-doubletime-payroll-rollout-plan.md).

## Cutlist
- **Cutlist optimizer parity** — Status: _Planned_, Owner: _Unassigned_. Benchmark strip vs guillotine, define offcut-quality metrics, and add optimization priority modes to `/cutlist`. Source: [cutlist optimizer parity plan](../plans/cutlist-optimizer-parity-plan.md).

## UI Tech Debt
- **Avoid hard‑coded status IDs in dashboard** — Status: _Backlog_, Owner: _Unassigned_. Replace numeric `status_id` filters with name‑based joins to `supplier_order_statuses` in `app/purchasing/page.tsx` to avoid environment ID drift.
- **Navbar page chrome rollout** — Status: _Planned_, Owner: _Unassigned_. Move page titles and per-page controls (e.g., toggles, badges) into the top navbar across all pages to free vertical space; leave sidebar for navigation only. See `docs/overview/STYLE_GUIDE.md` (`todo_navbar-page-chrome-rollout`).

## AI Assistant
- **Deliver Phase 1 read-only assistant** — Status: _In refinement_, Owner: _Unassigned_. Build the NLQ + RAG tooling, chat dock, and logging required for the initial assistant rollout. Source: [AI assistant plan – Phase 1](AI%20Assistant.md#phase-1-%E2%80%94-read-only-nlq-%2B-rag).
- **Document cost rollups for quote insights** — Status: _Backlog_, Owner: _Unassigned_. Replace placeholder cost calculations in the quote metrics view with exploded BOM and labor rollups. Source: [AI assistant metrics SQL TODO](AI%20Assistant.md#phase-1-%E2%80%94-read-only-nlq-%2B-rag).
- **Derive job duration actuals** — Status: _Backlog_, Owner: _Unassigned_. Implement actual-minute capture for job variance reporting by wiring attendance or job logs into the view. Source: [AI assistant metrics SQL TODO](AI%20Assistant.md#phase-1-%E2%80%94-read-only-nlq-%2B-rag).

## Operations
- **Finalize user activity logging rollout** — Status: _Planning_, Owner: _Unassigned_. Resolve open questions around retention, masking, and SIEM integrations before implementation proceeds. Source: [user logging plan open questions](../operations/user-logging.md#open-questions).
- **Stand up permissions management** — Status: _Planning_, Owner: _Unassigned_. Execute the roadmap for role definitions, permission matrix UI, RLS alignment, and audit hooks. Source: [permissions & logging plan](../plans/permissions-and-logging-plan.md).
- **Design sidebar personalization experiments** — Status: _Ideas_, Owner: _Unassigned_. Evaluate theme toggles, quick shortcuts, and section dividers for future sidebar iterations. Source: [sidebar enhancements ideas](../operations/sidebar-enhancements.md#ideas-for-future-iterations).

## Cross-Cutting / Historical Follow-Ups
- **Tighten todo module RLS** — Status: _Follow-up_, Owner: _Unassigned_. Revisit the permissive insert policy once JWT-based checks are validated for server routes. Source: [todo module fixes future improvements](../changelogs/todo-module-fixes-20251008.md#future-improvements).
- **Standardize date utilities across modules** — Status: _Follow-up_, Owner: _Unassigned_. Apply the new date formatting helpers to Labor/Staff, Purchasing, and Inventory workflows for consistent locale support. Source: [todo module fixes future improvements](../changelogs/todo-module-fixes-20251008.md#future-improvements).

## Maintenance Checklist (Optional)
Before major releases, run the following quick audit to keep this index accurate:

1. `rg --heading --line-number "TODO" docs | tee /tmp/docs-todo-scan.txt` to capture raw TODO references.
2. Review `/tmp/docs-todo-scan.txt` for new or resolved items; update `docs/overview/todo-index.md` entries accordingly.
3. Confirm each bullet still points to a valid source section and adjust anchors if headings move.
4. Commit updates alongside the relevant feature work so the index reflects the latest state.
