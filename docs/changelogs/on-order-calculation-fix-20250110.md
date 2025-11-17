# On Order Calculation Fix and Data Consistency Updates

**Date:** January 10, 2025
**Type:** Bug Fix + Data Migration
**Severity:** High
**Status:** ✅ Complete

---

## Overview

Fixed critical "On Order" calculation discrepancies in the component detail page where the "On Order" card and Purchase Orders table showed different values. The issue had two root causes: incorrect query logic and data inconsistencies in supplier order statuses.

---

## Problem Statement

### Issue #1: Query Logic Bug
The "On Order" card showed different values than the sum of the "Pending" column in the Purchase Orders table due to inconsistent JOIN patterns:
- **"On Order" query**: Used LEFT JOIN for status table, including orders with null status
- **Purchase Orders table**: Used INNER JOIN for status table, correctly filtering out invalid statuses

### Issue #2: Data Inconsistency
Two supplier orders had incorrect statuses that prevented them from appearing in the component detail page:
- **Order #64 (Q25-039)**: Status "Approved" instead of "Partially Received" (252/262 received)
- **Order #65 (Q25-040)**: Status "Completed" instead of "Partially Received" (192/262 received, 70 returned)

**Root Cause:** The `process_supplier_order_return` database function only updated status from "Fully Received" to "Partially Received", but didn't handle legacy "Completed" status.

---

## Solution

### 1. Query Logic Fixes

Updated four components to use consistent INNER JOIN pattern for status filtering:

#### Files Modified:

**[app/inventory/components/[id]/page.tsx](../../app/inventory/components/[id]/page.tsx)**
```typescript
// BEFORE: LEFT JOIN for status (included null statuses)
.select(`
  order_quantity,
  total_received,
  purchase_order_id,
  suppliercomponents!inner (component_id),
  status:supplier_order_statuses (status_name)  // ❌ LEFT JOIN
`)
.not('purchase_order_id', 'is', null);

// AFTER: INNER JOIN for status (filters null statuses)
.select(`
  order_quantity,
  total_received,
  purchase_order_id,
  purchase_order:purchase_orders!inner (purchase_order_id),
  suppliercomponents!inner (component_id),
  status:supplier_order_statuses!inner (status_name)  // ✅ INNER JOIN
`)
// Removed .not() filter - INNER JOIN handles this
```

**[components/features/inventory/ComponentsTab.tsx](../../components/features/inventory/ComponentsTab.tsx)**
- Added `purchase_order:purchase_orders!inner` INNER JOIN

**[components/features/inventory/OnOrderTab.tsx](../../components/features/inventory/OnOrderTab.tsx)**
- Added `purchase_order:purchase_orders!inner` INNER JOIN

**[components/features/inventory/component-detail/OrdersTab.tsx](../../components/features/inventory/component-detail/OrdersTab.tsx)**
- Changed `status:supplier_order_statuses(status_name)` to `status:supplier_order_statuses!inner(status_name)`
- Removed redundant `.not('purchase_order_id', 'is', null)` filter

### 2. Data Consistency Fix

**Migration:** [migrations/fix-supplier-order-statuses.sql](../../migrations/fix-supplier-order-statuses.sql)

The migration automatically corrects supplier order statuses based on actual received quantities:
- Orders with `0 < total_received < order_quantity` → Set to "Partially Received"
- Orders with `total_received >= order_quantity` → Set to "Fully Received"
- Includes comprehensive reporting and verification queries

**Orders Fixed:**
1. Order #64 (Q25-039): Approved → Partially Received
2. Order #65 (Q25-040): Completed → Partially Received
3. Order #73 (Q25-047): Status corrected

---

## Technical Details

### INNER JOIN vs LEFT JOIN

**The Key Difference:**
```sql
-- LEFT JOIN (old - includes nulls)
status:supplier_order_statuses(status_name)
-- Returns all supplier_orders, status_name can be null

-- INNER JOIN (new - excludes nulls)
status:supplier_order_statuses!inner(status_name)
-- Only returns supplier_orders with valid status
```

### Why The Bug Occurred

1. **Query inconsistency**: Different components used different JOIN strategies
2. **Null statuses**: Some supplier_orders had `status_id` pointing to non-existent status records
3. **Legacy data**: Orders marked as "Completed" instead of proper receiving statuses
4. **Returns workflow**: The return function didn't handle all status transitions

---

## Impact

### Before Fix
- **Component Detail Page "On Order"**: 30 units (missing 70 units from Q25-040)
- **Purchase Orders Table**: Showed only 3 orders, missing Q25-040
- **Inconsistency**: Users confused by mismatched numbers

### After Fix
- **Component Detail Page "On Order"**: 100 units (correct)
- **Purchase Orders Table**: Shows all 4 active orders
- **Consistency**: ✅ Card value matches table sum
- **Accuracy**: ✅ All calculations reflect true inventory status

### Test Results (Component 751 - WIDGET)
| Order | PO Number | Ordered | Received | Pending | Status |
|-------|-----------|---------|----------|---------|--------|
| 49 | Q25-025 | 15 | 0 | **15** | Approved |
| 64 | Q25-039 | 262 | 252 | **10** | Partially Received ✅ |
| 65 | Q25-040 | 262 | 192 | **70** | Partially Received ✅ |
| 73 | Q25-047 | 10 | 5 | **5** | Partially Received |
| **TOTAL** | | | | **100** | ✅ |

---

## Files Changed

### Code Changes (4 files)
1. `app/inventory/components/[id]/page.tsx` - Added INNER JOINs for purchase_order and status
2. `components/features/inventory/ComponentsTab.tsx` - Added purchase_order INNER JOIN
3. `components/features/inventory/OnOrderTab.tsx` - Added purchase_order INNER JOIN
4. `components/features/inventory/component-detail/OrdersTab.tsx` - Added status INNER JOIN, removed redundant filter

### Database Changes (1 file)
1. `migrations/fix-supplier-order-statuses.sql` - Corrects all misclassified supplier order statuses

### Documentation (3 files)
1. `docs/changelogs/on-order-calculation-fix-20250110.md` - This file
2. `docs/plans/fix-on-order-calculation-inner-join.md` - Updated status
3. `docs/domains/components/inventory-master.md` - Already documented

---

## Testing Performed

✅ **Query Consistency**
- Verified all "on order" queries use identical INNER JOIN patterns
- Confirmed null statuses are properly filtered out

✅ **Data Verification**
- Ran migration on production data
- Verified 3 orders corrected (64, 65, 73)
- Confirmed no other misclassified orders exist

✅ **UI Verification**
- Component detail page "On Order" card: 100 units ✅
- Purchase Orders table shows 4 orders ✅
- Sum of "Pending" column: 100 units ✅
- All statuses display correctly

✅ **Edge Cases**
- Components with no purchase orders: Shows 0 ✅
- Components with multiple POs: Sums correctly ✅
- Partially received orders: Shows remaining quantity ✅

---

## Related Issues

### Discovered During Investigation
The `process_supplier_order_return` function has a limitation where it only handles status transitions from "Fully Received" to "Partially Received", but doesn't account for legacy "Completed" status. This was addressed by the data migration but may need a function update to prevent future occurrences.

**Recommendation:** Update `process_supplier_order_return` to also check for "Completed" status when calculating new status after returns.

---

## Future Considerations

1. **Status Monitoring**: Add alerts for supplier_orders with mismatched status vs. received quantities
2. **Function Update**: Enhance `process_supplier_order_return` to handle all status types
3. **Data Validation**: Add database constraint to ensure statuses match received quantities
4. **Audit Trail**: Consider tracking status changes for better debugging

---

## Verification Query

Use this query to verify all statuses are correct:

```sql
SELECT
  so.order_id,
  po.q_number,
  so.order_quantity,
  so.total_received,
  (so.order_quantity - COALESCE(so.total_received, 0)) as pending,
  sos.status_name as current_status,
  CASE
    WHEN so.total_received >= so.order_quantity THEN 'Fully Received'
    WHEN so.total_received > 0 THEN 'Partially Received'
    ELSE 'Open/Approved'
  END as expected_status,
  CASE
    WHEN (so.total_received >= so.order_quantity AND sos.status_name = 'Fully Received') THEN '✅'
    WHEN (so.total_received > 0 AND so.total_received < so.order_quantity AND sos.status_name = 'Partially Received') THEN '✅'
    WHEN (so.total_received = 0 AND sos.status_name IN ('Open', 'Approved')) THEN '✅'
    ELSE '❌ NEEDS FIX'
  END as status_check
FROM supplier_orders so
LEFT JOIN purchase_orders po ON so.purchase_order_id = po.purchase_order_id
LEFT JOIN supplier_order_statuses sos ON so.status_id = sos.status_id
WHERE so.total_received IS NOT NULL
ORDER BY status_check DESC, so.order_id;
```

---

## Credits

**Investigated by:** Claude Code
**Tested by:** User verification + automated queries
**Approved by:** Migration successfully executed

---

## Status Updates

- ✅ **Code changes**: Deployed and tested
- ✅ **Database migration**: Successfully executed
- ✅ **UI verification**: All values match and display correctly
- ✅ **Documentation**: Complete
- ✅ **Testing**: Passed all verification checks
