# Tenant Rollout Status (Production)

This is a short "where are we now" checkpoint for the multi-tenant rollout. For the authoritative procedure, see:
- `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`

## Current Production State (as of 2026-02-22)

### Organization model
- Organizations exist (`public.organizations`) and users are linked via `public.organization_members`.
- Every current `auth.users` row has been backfilled to have an `organization_members` row (prevents partial RLS null-joins).

### Module licensing (org entitlements)
- Tenant module entitlements exist and can gate features by organization. See `docs/operations/tenant-module-entitlements-runbook.md`.

### Domain data isolation
Tenant-scoped RLS is enabled and enforced for core domain tables (org_id + policies in place):
- `products`
- `customers`
- `orders`
- `order_details`
- `components`
- `inventory`
- `inventory_transactions`
- `product_inventory`
- `product_inventory_transactions`
- `product_reservations`

Expand-only `org_id` columns have been added and backfilled (but RLS has NOT been tightened yet) for follow-on tables:
- Purchasing + Suppliers (purchase orders, supplier orders, supplier mappings, receipts/returns, attachments/emails)
- Quotes (quotes, quote items, quote cutlists/attachments/logs)
- Staff (staff, hours, payroll tables)
- Timekeeping (`time_clock_events`, `time_segments`, and `time_daily_summary` moved to org-scoped RLS on 2026-02-21)
- Phase C timekeeping org FKs validated on 2026-02-21 (`time_clock_events_org_id_fkey`, `time_segments_org_id_fkey`, `time_daily_summary_org_id_fkey`)
- Phase C timekeeping `org_id` columns enforced `NOT NULL` on 2026-02-21 (`time_clock_events`, `time_segments`, `time_daily_summary`)

### Purchasing/Suppliers RLS baby-step progress
- `suppliers` is now tenant-scoped with org membership policies (migration: `tenant_rls_step13_suppliers_replace_broad_with_org`, applied 2026-02-20).
- `purchase_orders` is now tenant-scoped with org membership policies (migration: `tenant_rls_step14_purchase_orders_replace_broad_with_org`, applied 2026-02-21).
- `supplier_orders` is now tenant-scoped with org membership policies (migration: `tenant_rls_step15_supplier_orders_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `suppliercomponents` is now tenant-scoped with org membership policies (migration: `tenant_rls_step16_suppliercomponents_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `supplier_order_returns` is now tenant-scoped with org membership policies (migration: `tenant_rls_step17_supplier_order_returns_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `supplier_order_receipts` is now tenant-scoped with org membership policies (migration: `tenant_rls_step18_supplier_order_receipts_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `purchase_order_attachments` is now tenant-scoped with org membership policies (migration: `tenant_rls_step19_purchase_order_attachments_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `purchase_order_emails` is now tenant-scoped with org membership policies (migration: `tenant_rls_step20_purchase_order_emails_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `quotes` is now tenant-scoped with org membership policies (migration: `tenant_rls_step21_quotes_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `quote_items` is now tenant-scoped with org membership policies (migration: `tenant_rls_step22_quote_items_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `quote_attachments` is now tenant-scoped with org membership policies (migration: `tenant_rls_step23_quote_attachments_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `quote_email_log` is now tenant-scoped with org membership policies (migration: `tenant_rls_step24_quote_email_log_replace_broad_with_org`, applied + smoke-verified on 2026-02-21).
- `staff` is now tenant-scoped with org membership policies (migration: `tenant_rls_step25_staff_replace_broad_with_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/staff`, `/staff/hours`, and `/staff/payroll`).
- `staff_hours` is now tenant-scoped with org membership policies (migration: `tenant_rls_step26_staff_hours_replace_broad_with_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/staff/hours` and `/staff/payroll`).
- `time_clock_events` is now tenant-scoped for authenticated access, with anonymous insert preserved for public clock-in flow (migration: `tenant_rls_step27_time_clock_events_split_anon_and_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/staff/hours`).
- `time_segments` is now tenant-scoped with org membership policies (migration: `tenant_rls_step28_time_segments_replace_broad_with_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/staff/hours`).
- `time_daily_summary` is now tenant-scoped with org membership policies (migration: `tenant_rls_step29_time_daily_summary_replace_broad_with_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/staff/hours`).
- `suppliers.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step32_suppliers_enforce_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/suppliers` and `/purchasing`.
- `purchase_orders.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step33_purchase_orders_enforce_org`, applied + smoke-verified on 2026-02-21 as normal user `testai@qbutton.co.za` on `/purchasing` and `/purchasing/purchase-orders/203`.
- `supplier_orders.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step34_supplier_orders_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing` and `/purchasing/purchase-orders/203`.
- `suppliercomponents.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step35_suppliercomponents_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing` and `/purchasing/purchase-orders/203`.
- `supplier_order_returns.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step36_supplier_order_returns_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing` and `/purchasing/purchase-orders/203`.
- `supplier_order_receipts.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step37_supplier_order_receipts_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing` and `/purchasing/purchase-orders/203`.
- `purchase_order_attachments.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step38_purchase_order_attachments_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing/purchase-orders/203`.
- `purchase_order_emails.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step39_purchase_order_emails_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing/purchase-orders/203`.
- `quotes.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step40_quotes_enforce_org`, applied + smoke-verified on 2026-02-22 on `/quotes` and `/quotes/<id>`.
- `quote_items.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step41_quote_items_enforce_org`, applied + smoke-verified on 2026-02-22 on quote detail APIs.
- `quote_attachments.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step42_quote_attachments_enforce_org`, applied + smoke-verified on 2026-02-22 on quote attachment reads.
- `quote_email_log.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step43_quote_email_log_enforce_org`, applied + smoke-verified on 2026-02-22 on quote email-status flows.
- `staff.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step44_staff_enforce_org`, applied + smoke-verified on 2026-02-22 on `/staff/hours` (same expected `406` missing-summary pattern as before).
- `staff_hours.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step45_staff_hours_enforce_org`, applied + smoke-verified on 2026-02-22 on `/staff/hours` (same expected `406` missing-summary pattern as before).
- `product_cutlist_groups.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step46_product_cutlist_groups_enforce_org`, applied on 2026-02-22 with zero null/mismatch precheck.
- `product_cutlist_groups` is now tenant-scoped with org membership policies via migration `tenant_rls_step47_product_cutlist_groups_replace_broad_with_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/products/812/cutlist-builder` (`/api/products/812/cutlist-groups` returned `200`).
- `supplier_pricelists.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step48_supplier_pricelists_enforce_org`, applied on 2026-02-22 with zero null-row precheck.
- `supplier_pricelists` is now tenant-scoped with org membership policies via migration `tenant_rls_step49_supplier_pricelists_replace_broad_with_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/suppliers` (nested `supplier_pricelists` read returned `200`).
- `quote_company_settings.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step50_quote_company_settings_enforce_org`, applied on 2026-02-22 with zero null-row precheck.
- `quote_company_settings` is now tenant-scoped with org membership policies and RLS enabled via migration `tenant_rls_step51_quote_company_settings_enable_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/settings`, `/quotes`, and `/purchasing`.
- `purchase_order_activity.org_id` is now constraint-enforced (`NOT NULL`) via migration `tenant_org_scoping_phase_b_step52_purchase_order_activity_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing` and PO detail/list pages.
- `supplier_emails.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step53_supplier_emails_enforce_org`, applied on 2026-02-22 with zero null-row precheck.
- `supplier_emails` is now tenant-scoped with org membership policies via migration `tenant_rls_step54_supplier_emails_replace_broad_with_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/suppliers` and `/purchasing/purchase-orders/142` (nested `supplier_emails` reads returned `200`).
- `staff_weekly_hours.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step55_staff_weekly_hours_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/staff/hours` and `/staff/payroll`.
- `staff_weekly_payroll.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step56_staff_weekly_payroll_enforce_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/staff/payroll` and `/staff/hours`.
- `supplier_follow_up_responses.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step57_supplier_follow_up_responses_enforce_org`, applied on 2026-02-22 with zero null-row precheck.
- `supplier_follow_up_responses` is now tenant-scoped with org membership policies via migration `tenant_rls_step58_supplier_follow_up_responses_replace_broad_with_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on purchasing/supplier flows.
- `supplier_order_customer_orders.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step59_supplier_order_customer_orders_enforce_org`, applied on 2026-02-22 with zero null-row precheck.
- `supplier_order_customer_orders` is now tenant-scoped with org membership policies and RLS enabled via migration `tenant_rls_step60_supplier_order_customer_orders_enable_org`, applied + smoke-verified on 2026-02-22 as normal user `testai@qbutton.co.za` on `/purchasing/purchase-orders/142` and `/purchasing`.
- `quote_cluster_lines.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step61_quote_cluster_lines_enforce_org`, and `quote_cluster_lines` now has org-scoped RLS via `tenant_rls_step62_quote_cluster_lines_enable_org` (applied 2026-02-22).
- `quote_item_clusters.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step63_quote_item_clusters_enforce_org`, and `quote_item_clusters` now has org-scoped RLS via `tenant_rls_step64_quote_item_clusters_enable_org` (applied 2026-02-22).
- `quote_item_cutlists.org_id` is now constraint-enforced (FK validated + `NOT NULL`) via migration `tenant_org_scoping_phase_b_step65_quote_item_cutlists_enforce_org`, and `quote_item_cutlists` now has org-scoped RLS via `tenant_rls_step66_quote_item_cutlists_enable_org` (applied + smoke-verified 2026-02-22 on `/quotes` and quote detail).
- Phase B + staff/quotes constraint enforcement is now complete for the scoped tables in this rollout batch.
- Local app hardening update (2026-02-22): replaced optional `time_daily_summary` `.single()` reads with `.limit(1)` in `components/features/staff/DailyAttendanceGrid.tsx` and `components/features/staff/DailyHoursDetailDialog.tsx` to remove expected-but-noisy `406` responses for missing per-staff daily summary rows; local smoke on `/staff/hours` as normal user shows `200` responses for those reads.

## What’s Next (recommended order)
1. Continue production hardening checks and normal-user smoke tests across the most-used flows while constraints/RLS are now in place across current `org_id` tables.
2. Plan tenant-aware unique constraints for future multi-tenant growth (for example, replacing global unique keys with `(org_id, key)` variants in a separate controlled rollout).
3. Prepare second-organization onboarding checklist (membership bootstrap, module entitlements, and first-user acceptance tests).

## Known Non-Tenancy Smoke Anomalies (local/dev)
- `cutlist_material_defaults` can return `406` for users without a saved defaults row (`/products/<id>/cutlist-builder`); this is an expected missing-row pattern, not an org-RLS regression.
- `/orders/294` in local smoke returned `406` (missing order row) and `/api/orders/294/fg-reservations` `401`; this is data/auth-context specific in the local test path and should be triaged separately from tenancy.
- `/orders` occasionally shows `get_procurement_summaries_raw` `404` during rapid scripted navigation; observed as intermittent and likely unrelated to org-scoping changes.
