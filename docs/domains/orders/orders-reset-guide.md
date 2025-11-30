**Orders Reset Guide**

- **Purpose:** Clean Orders data (headers, lines, attachments, and junction links) to prepare a fresh test order. Purchasing can be cleaned separately.
- **Scope:** `orders`, `order_details`, `order_attachments`, `stock_issuances`, `supplier_order_customer_orders`, related `inventory_transactions`, and Supabase Storage files under `qbutton/Orders/Customer/<customer_id>/`.

**Dry‑Run (SQL preview)**

Run in the Supabase SQL editor to preview impact for your chosen scope.

-- 1) Scope orders
WITH ord_target AS (
  SELECT order_id, customer_id
  FROM orders
  -- WHERE created_at >= '2025-01-01'  -- ← optional filter
)
-- 2) Counts to be affected
SELECT
  (SELECT count(*) FROM ord_target) AS order_count,
  (SELECT count(*) FROM order_details od WHERE od.order_id IN (SELECT order_id FROM ord_target)) AS detail_count,
  (SELECT count(*) FROM order_attachments oa WHERE oa.order_id IN (SELECT order_id FROM ord_target)) AS attachment_rows,
  (SELECT count(*) FROM supplier_order_customer_orders soco WHERE soco.order_id IN (SELECT order_id FROM ord_target)) AS junction_rows;

-- 3) Customers whose storage folders will be touched
SELECT DISTINCT customer_id FROM ord_target ORDER BY customer_id;

Note: Storage files are not visible via SQL; use the script below to list and remove them.

**Apply (scripted, safe)**

- Use `scripts/cleanup-orders.ts` (see below) to:
  - Reverse inventory for stock issuances (adds back issued quantities).
  - Delete `stock_issuances` and their linked `inventory_transactions`.
  - Delete DB rows in order: junctions → attachments → details → orders.
  - Remove files in Storage under `Orders/Customer/<customer_id>/` for affected customers.
  - Supports `--dry-run`, `--after=YYYY-MM-DD`, and `--orderIds=...` flags.

**Tables Affected**

| Table | Action |
|-------|--------|
| `orders` | Deleted |
| `order_details` | Deleted |
| `order_attachments` | Deleted |
| `stock_issuances` | Deleted |
| `inventory_transactions` | Issuance transactions deleted |
| `inventory` | `quantity_on_hand` reversed (issued qty added back) |
| `supplier_order_customer_orders` | Junction links deleted |

Commands:

- Preview: `npx tsx scripts/cleanup-orders.ts --dry-run`
- Apply all: `npx tsx scripts/cleanup-orders.ts`
- Filter by date: `npx tsx scripts/cleanup-orders.ts --after=2025-01-01`
- Filter by IDs: `npx tsx scripts/cleanup-orders.ts --orderIds=23955,23950`

**Post‑Cleanup**

- Refresh component views if used: `SELECT refresh_component_views();`
- Optional: Run Purchasing reset if you want a fully clean pipeline (see `docs/domains/purchasing/purchasing-reset-guide.md`).

**Caveats**

- Storage deletion is destructive. Ensure you are targeting the correct customers and have backups if needed.
- If you keep existing POs, their supplier orders will remain but the link to the cleaned orders is removed.

