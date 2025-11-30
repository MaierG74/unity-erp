# Purchase Order RPC Per-Line Customer Order Association

**Date:** November 20, 2025  
**Type:** Database Migration  
**Status:** ✅ Applied

---

## Overview

The purchasing workflow now supports associating each supplier order line with a specific customer order. The RPC helper `create_purchase_order_with_lines` was updated to accept a per-line `customer_order_id` (inside each JSON payload item) and persist those links through `supplier_order_customer_orders`.

Migration [`migrations/20251120_update_purchase_order_rpc_per_line.sql`](../../migrations/20251120_update_purchase_order_rpc_per_line.sql) has been executed in Supabase to roll out the schema change so the new UI can save correctly.

---

## Changes

1. Dropped the previous `create_purchase_order_with_lines` overload that accepted a top-level `customer_order_id`.
2. Recreated the function with the following behavior:
   - Inserts the purchase order and supplier order rows as before.
   - Extracts `customer_order_id` from each `line_items` JSON element.
   - Populates `supplier_order_customer_orders` per supplier order line, ensuring `quantity_for_order` / `quantity_for_stock` values remain intact.
3. Leaves the return signature unchanged (`purchase_order_id`, `supplier_order_ids`) for compatibility.

---

## Verification

Run a quick insert via the updated UI or Supabase SQL editor:

```sql
select * from create_purchase_order_with_lines(
  1,
  '[{"supplier_component_id":123,"order_quantity":5,"component_id":456,"quantity_for_order":5,"quantity_for_stock":0,"customer_order_id":789}]'
);
```

Verify that `supplier_order_customer_orders` contains the new supplier order id linked to `order_id = 789`.

---

## Follow Ups

- ✅ Updated `app/orders/[orderId]/page.tsx` to pass `customer_order_id` inside each line payload (fixed Nov 26, 2025).
- Update any reporting/query logic to leverage the new per-line association where needed.
