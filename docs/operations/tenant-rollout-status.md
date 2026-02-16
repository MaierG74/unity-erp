# Tenant Rollout Status (Production)

This is a short "where are we now" checkpoint for the multi-tenant rollout. For the authoritative procedure, see:
- `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`

## Current Production State (as of 2026-02-15)

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

## What’s Next (recommended order)
1. Tighten Purchasing + Suppliers RLS, one table at a time, with smoke tests after each change.
2. Tighten Quotes RLS (similar baby-step rollout).
3. Tighten Staff RLS.
4. Validate and enforce FK constraints (VALIDATE CONSTRAINT) and later `NOT NULL` on the Phase B tables.

