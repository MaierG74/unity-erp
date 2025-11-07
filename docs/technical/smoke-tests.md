# Smoke Tests

Quick, high-level checks that core flows work end-to-end without deep setup.

## Purchasing Smoke

- What it does:
  - Seeds a temporary supplier, component, and supplier component.
  - Creates a purchase order (unlinked SO for simplicity).
  - Creates a supplier order line and approves the PO (assigns Q number).
  - Receives a partial quantity and verifies:
    - `supplier_order_receipts` has a row.
    - `inventory_transactions` row has `component_id` set and `order_id` null.
    - `inventory.quantity_on_hand` increases.
    - Supplier order totals recompute via RPC or manual fallback.
  - Manual UI spot-check: in `purchasing/purchase-orders/new`, select two items that share a supplier and confirm the form groups them into a single PO using the cached supplier map (no extra lookups during submit).

- Run
  - Ensure `.env.local` has `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
  - `pnpm tsx scripts/smoke-purchasing.ts`
  - Or: `pnpm smoke:purchasing`

- Location
  - Script: `scripts/smoke-purchasing.ts`

Keep runtime under a minute. The script leaves small test data; clean-up is optional for smoke.
