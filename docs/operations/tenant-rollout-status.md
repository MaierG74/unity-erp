# Tenant Rollout Status (Production)

This is a short "where are we now" checkpoint for the multi-tenant rollout. For the authoritative procedure, see:
- `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`

## Current Production State (as of 2026-02-21)

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
- Remaining purchasing/supplier tables are still in expand-only state and should be tightened one-by-one.

## What’s Next (recommended order)
1. Apply expand-only migration for `product_cutlist_groups` (`org_id` + backfill + FK NOT VALID + index) before onboarding a second organization.
2. Continue tightening Quotes RLS in baby steps (next recommended table: `quote_attachments`).
3. Continue tightening remaining purchasing/supplier edge tables if any are identified without org-scoped policies.
4. Tighten Staff RLS.
5. Validate and enforce FK constraints (`VALIDATE CONSTRAINT`) and later `NOT NULL` on the Phase B tables.
