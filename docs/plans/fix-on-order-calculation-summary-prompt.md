# Summary Prompt for Fixing On Order Calculation Discrepancy

Copy and paste this into another chat window:

---

The "On Order" card on the component detail page (`app/inventory/components/[id]/page.tsx`) shows 30 units, but the sum of "Pending" quantities in the Purchase Orders table (`components/features/inventory/component-detail/OrdersTab.tsx`) is 102 units.

**Root Cause:**
The "On Order" query only checks for non-null `purchase_order_id` but doesn't verify the `purchase_order` actually exists. The Purchase Orders table uses an `INNER JOIN` with `purchase_orders`, which correctly filters out `supplier_orders` linked to non-existent (deleted) purchase orders. This means orphaned `supplier_orders` rows are included in the "On Order" calculation but not shown in the table.

**Solution:**
Update the `onOrderData` query in `app/inventory/components/[id]/page.tsx` (lines 65-95) to use an `INNER JOIN` with `purchase_orders`, matching the OrdersTab table logic. Add `purchase_order:purchase_orders!inner (purchase_order_id)` to the select statement and remove the `.not('purchase_order_id', 'is', null)` filter since the INNER JOIN handles this more robustly.

**Reference Implementation:**
See `components/features/inventory/component-detail/OrdersTab.tsx` line 40 for the correct query pattern.

**Files to Update:**
- `app/inventory/components/[id]/page.tsx` - Update onOrderData query
- Documentation already updated in `docs/domains/components/inventory-master.md`
- Plan document created at `docs/plans/fix-on-order-calculation-inner-join.md`

**Expected Result:**
After the fix, the "On Order" value should match the sum of "Pending" column in the Purchase Orders table, as both will only count `supplier_orders` linked to existing purchase orders.

---






