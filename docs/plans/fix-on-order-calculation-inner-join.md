# Fix On Order Calculation - Use INNER JOIN with Purchase Orders

## Problem
The "On Order" card on the component detail page shows 30 units, but the sum of "Pending" quantities in the Purchase Orders table is 102 units. This discrepancy occurs because:
- The "On Order" query only checks for non-null `purchase_order_id` but doesn't verify the `purchase_order` actually exists
- The Purchase Orders table uses an `INNER JOIN` with `purchase_orders`, which correctly filters out `supplier_orders` linked to non-existent (deleted) purchase orders
- This means orphaned `supplier_orders` rows (from deleted purchase orders) are included in the "On Order" calculation but not shown in the table

## Solution
Update the "On Order" calculation query to use an `INNER JOIN` with `purchase_orders`, matching the OrdersTab table logic. This ensures both the card and table only count `supplier_orders` linked to *existing* purchase orders.

## Implementation Details

**File: `app/inventory/components/[id]/page.tsx`**

**Current query (lines 65-95):**
- Filters by `.not('purchase_order_id', 'is', null)` but doesn't verify purchase_order exists
- Includes orphaned supplier_orders from deleted purchase orders

**Updated query:**
```typescript
// Fetch on-order quantity (only from existing purchase orders)
const { data: onOrderData } = useQuery({
  queryKey: ['component', componentId, 'on-order'],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('supplier_orders')
      .select(`
        order_quantity,
        total_received,
        purchase_order_id,
        purchase_order:purchase_orders!inner (
          purchase_order_id
        ),
        suppliercomponents!inner (
          component_id
        ),
        status:supplier_order_statuses!inner (
          status_name
        )
      `)
      .eq('suppliercomponents.component_id', componentId)
      .in('status.status_name', ['Open', 'In Progress', 'Approved', 'Partially Received', 'Pending Approval']);

    if (error) throw error;

    const total = (data || []).reduce((sum, order) => {
      return sum + ((order.order_quantity || 0) - (order.total_received || 0));
    }, 0);

    return total;
  },
  enabled: !isNaN(componentId),
});
```

**Key changes:**
1. Add `purchase_order:purchase_orders!inner (...)` to the select - this creates an INNER JOIN that filters out supplier_orders where purchase_order doesn't exist
2. Remove `.not('purchase_order_id', 'is', null)` filter as the INNER JOIN handles this more robustly
3. This matches the OrdersTab query logic exactly (line 40 in OrdersTab.tsx)

## Testing
- Verify "On Order" value matches sum of "Pending" column in Purchase Orders table
- Verify "On Order" count matches distinct purchase orders count
- Test with components that have orphaned supplier_orders from deleted purchase orders
- Ensure the value updates correctly when purchase orders are created/received/deleted

## Impact
- "On Order" will now only reflect quantities from *existing* purchase orders
- Orphaned supplier_orders (from deleted purchase orders) will be excluded
- The value will match what users see in the Purchase Orders table
- Consistent behavior between card and table

## Related Files
- `app/inventory/components/[id]/page.tsx` - Component detail page with "On Order" calculation
- `components/features/inventory/component-detail/OrdersTab.tsx` - Purchase Orders table (reference implementation)
- `docs/domains/components/inventory-master.md` - Updated documentation

## Status
- [x] Implementation complete (2025-01-10)
- [x] Testing complete - all values match correctly
- [x] Documentation updated
- [x] Additional issues discovered and resolved (see changelog)

## Final Resolution

This fix was successfully implemented on January 10, 2025. During implementation, we discovered a related issue where supplier order statuses were incorrect due to a legacy data problem. Both issues have been resolved:

1. **Query logic fix**: All four components now use consistent INNER JOIN patterns
2. **Data consistency fix**: Migration corrected 3 orders with wrong statuses (orders 64, 65, 73)

See [docs/changelogs/on-order-calculation-fix-20250110.md](../changelogs/on-order-calculation-fix-20250110.md) for complete details.






