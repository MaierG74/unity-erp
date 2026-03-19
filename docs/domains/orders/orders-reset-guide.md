**Orders Reset Guide**

- **Purpose:** Clean Orders data for a tightly scoped test run such as `TEST-LC-001`. Purchasing can be cleaned separately.
- **Scope:** `orders`, `order_details`, `order_attachments`, `stock_issuances`, `supplier_order_customer_orders`, `job_cards`, `job_card_items`, `job_work_pool`, related `inventory_transactions`, and Supabase Storage files under `qbutton/Orders/Customer/<customer_id>/`.

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
  - Delete `job_card_items` and `job_cards` for the targeted order ids.
  - Delete `job_work_pool` rows for the targeted order ids after job-card rows are gone, allowing `order_details` to be removed cleanly. Any `job_work_pool_exceptions` / exception activity rows cascade automatically from the pool rows.
  - Delete `stock_issuances` and their linked `inventory_transactions`.
  - Delete DB rows in order: junctions → attachments → details → orders.
  - Remove files in Storage under `Orders/Customer/<customer_id>/` for affected customers.
  - Supports `--dry-run`, `--after=YYYY-MM-DD`, and `--orderIds=...` flags.
  - Supports `--include-labor-assignments` when you also want to delete `labor_plan_assignments` rows for the same order ids.
  - By default, it only warns when `labor_plan_assignments` rows still reference the order.

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
| `job_cards` | Deleted for targeted orders |
| `job_card_items` | Deleted for targeted order job cards |
| `job_work_pool` | Deleted for targeted orders |
| `job_work_pool_exceptions` | Cascade-deleted with pool rows |
| `job_work_pool_exception_activity` | Cascade-deleted with exception rows |
| `labor_plan_assignments` | Deleted only when `--include-labor-assignments` is passed |

Commands:

- Preview: `npx tsx scripts/cleanup-orders.ts --dry-run`
- Apply all: `npx tsx scripts/cleanup-orders.ts`
- Filter by date: `npx tsx scripts/cleanup-orders.ts --after=2025-01-01`
- Filter by IDs: `npx tsx scripts/cleanup-orders.ts --orderIds=23955,23950`
- Single test order: `npx tsx scripts/cleanup-orders.ts --dry-run --orderIds=<TEST_ORDER_ID>`
- Single test order with labor cleanup: `npx tsx scripts/cleanup-orders.ts --dry-run --orderIds=<TEST_ORDER_ID> --include-labor-assignments`

**Post‑Cleanup**

- Refresh component views if used: `SELECT refresh_component_views();`
- Optional: Run Purchasing reset if you want a fully clean pipeline (see `docs/domains/purchasing/purchasing-reset-guide.md`).
- If your test used labor planning or factory-floor issuance, either include `--include-labor-assignments` during the order reset or clean those rows separately before re-running the scenario.

**Caveats**

- Storage deletion is destructive. Ensure you are targeting the correct customers and have backups if needed.
- If you keep existing POs, their supplier orders will remain but the link to the cleaned orders is removed.
- The script is intended for narrow test cleanup. Prefer `--orderIds=<single id>` for lifecycle tests instead of broad date-based wipes.
- `--include-labor-assignments` is intentionally opt-in because it removes factory-floor planning records, not just order execution records.
- Orders that used `Generate from BOL` or `Add Job` create `job_work_pool` rows. Those rows must be removed before `order_details`, otherwise Postgres will block the delete on `job_work_pool_order_detail_id_fkey`.
