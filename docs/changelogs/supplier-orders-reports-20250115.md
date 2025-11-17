# Supplier Orders & Reports Tabs Implementation

**Date:** January 15, 2025  
**Status:** ✅ Complete

## Summary

Added two new tabs to the Supplier detail page: **Orders** and **Reports**. These tabs provide comprehensive visibility into purchase order history, filtering capabilities, and analytical insights for each supplier.

## Features Added

### Orders Tab (`components/features/suppliers/supplier-orders.tsx`)

Displays all purchase orders for a specific supplier with advanced filtering and expandable line item details.

**Toolbar Features:**
- **Date Type Selector**: Choose between Order Date, Receipt Date, or Created Date for filtering
- **From Date / To Date pickers**: Filter orders by date range
- **Status Filter**: Filter by Draft, Pending Approval, Approved, Partially Received, Fully Received, or Cancelled
- **Q Number Search**: Case-insensitive search for specific purchase orders
- **Reset Filters Button**: Clear all filters at once

**Table Columns:**
- Expand/Collapse button for line items
- Q Number (clickable link to PO detail page)
- Order Date
- Status (color-coded badge)
- Total Value (ZAR currency formatted)
- Items count
- Progress (received/ordered with visual progress bar)

**Expandable Line Items:**
- Component code and description
- Supplier code
- Unit price
- Quantity ordered
- Quantity received
- Line total

**Summary:**
- Total Orders count
- Total Value sum (currency formatted)

### Reports Tab (`components/features/suppliers/supplier-reports.tsx`)

Provides analytical insights and statistics about supplier performance.

**Date Range Filter:**
- From Date / To Date pickers to scope all statistics
- Defaults to "All Time" if no dates selected

**Statistics Cards:**
1. **Total Orders**: Count of purchase orders
2. **Total Order Value**: Sum of all PO line totals (ZAR)
3. **Outstanding Orders**: Count and value of orders not fully received
4. **Average Lead Time**: Calculated from order date to first receipt date (in days)
5. **On-Time Delivery Rate**: Percentage of orders received within expected lead time
6. **Unique Components**: Count of distinct components ordered

**Additional Sections:**
- **Orders by Status**: Grid showing order counts by status with color-coded badges
- **Recent Purchase Orders**: Timeline of last 10 orders with dates, items, and totals

## Technical Implementation

### Types Added

**File:** `types/suppliers.ts`

```typescript
export type SupplierPurchaseOrder = {
  purchase_order_id: number;
  q_number: string | null;
  order_date: string;
  created_at: string;
  notes: string | null;
  status: { status_name: string };
  supplier_orders: SupplierOrderLineItem[];
};

export type SupplierOrderLineItem = {
  order_id: number;
  order_quantity: number;
  total_received: number;
  supplier_component: {
    supplier_component_id: number;
    supplier_code: string;
    price: number;
    lead_time: number | null;
    component: {
      component_id: number;
      internal_code: string;
      description: string;
    };
  };
  receipts: Array<{
    receipt_date: string;
    quantity_received: number;
  }>;
};

export type SupplierStatistics = {
  totalOrders: number;
  totalValue: number;
  outstandingOrders: number;
  outstandingValue: number;
  averageLeadTime: number | null;
  onTimeDeliveryRate: number | null;
  uniqueComponents: number;
  ordersByStatus: Record<string, number>;
};
```

### Database Queries

**Orders Query:**
```typescript
const { data, error } = await supabase
  .from('purchase_orders')
  .select(`
    purchase_order_id,
    q_number,
    order_date,
    created_at,
    notes,
    status:supplier_order_statuses!purchase_orders_status_id_fkey(status_name),
    supplier_orders!inner(
      order_id,
      order_quantity,
      total_received,
      supplier_component:suppliercomponents!inner(
        supplier_component_id,
        supplier_code,
        price,
        lead_time,
        supplier_id,
        component:components(
          component_id,
          internal_code,
          description
        )
      ),
      receipts:supplier_order_receipts(
        receipt_date,
        quantity_received
      )
    )
  `)
  .eq('supplier_orders.suppliercomponents.supplier_id', supplierId)
  .order('order_date', { ascending: false });
```

### Date Filtering Pattern

Follows the same pattern as Purchase Orders page (`app/purchasing/purchase-orders/page.tsx:268-289`):

```typescript
// Set time to beginning of day for start date
const startDateWithoutTime = new Date(startDate);
startDateWithoutTime.setHours(0, 0, 0, 0);

// Set time to end of day for end date  
const endDateWithoutTime = new Date(endDate);
endDateWithoutTime.setHours(23, 59, 59, 999);

// Compare using date-fns
if (isBefore(orderDate, startDateWithoutTime)) return false;
if (isAfter(orderDate, endDateWithoutTime)) return false;
```

### Statistics Calculations

**Average Lead Time:**
```typescript
const leadTimes: number[] = [];
filteredOrders.forEach(order => {
  order.supplier_orders.forEach(line => {
    if (line.receipts && line.receipts.length > 0) {
      const orderDate = parseISO(order.order_date || order.created_at);
      const firstReceiptDate = parseISO(line.receipts[0].receipt_date);
      const daysDiff = differenceInDays(firstReceiptDate, orderDate);
      if (daysDiff >= 0) leadTimes.push(daysDiff);
    }
  });
});

const averageLeadTime = leadTimes.length > 0
  ? Math.round(leadTimes.reduce((sum, days) => sum + days, 0) / leadTimes.length)
  : null;
```

**On-Time Delivery Rate:**
```typescript
let onTimeDeliveries = 0;
let totalDeliveries = 0;

filteredOrders.forEach(order => {
  order.supplier_orders.forEach(line => {
    if (line.receipts && line.receipts.length > 0 && line.supplier_component?.lead_time) {
      totalDeliveries++;
      const actualLeadTime = differenceInDays(
        parseISO(line.receipts[0].receipt_date),
        parseISO(order.order_date || order.created_at)
      );
      if (actualLeadTime <= line.supplier_component.lead_time) {
        onTimeDeliveries++;
      }
    }
  });
});

const onTimeDeliveryRate = totalDeliveries > 0
  ? Math.round((onTimeDeliveries / totalDeliveries) * 100)
  : null;
```

## Files Modified

1. **`app/suppliers/[id]/page.tsx`**
   - Added lazy imports for `SupplierOrders` and `SupplierReports`
   - Added "Orders" and "Reports" tabs to TabsList
   - Added corresponding TabsContent sections with Suspense wrappers

2. **`types/suppliers.ts`**
   - Added `SupplierPurchaseOrder`, `SupplierOrderLineItem`, and `SupplierStatistics` types

## Files Created

1. **`components/features/suppliers/supplier-orders.tsx`** (601 lines)
   - Orders tab component with filtering and expandable rows

2. **`components/features/suppliers/supplier-reports.tsx`** (580 lines)
   - Reports tab component with statistics cards and recent activity

3. **`docs/changelogs/supplier-orders-reports-20250115.md`**
   - This changelog document

## Testing Verification

### Orders Tab
- ✅ Displays all purchase orders for supplier (tested with ISA Components and Apex Manufacturing)
- ✅ Date type selector works (Order Date, Receipt Date, Created Date)
- ✅ Date range filtering correctly filters orders
- ✅ Status filter works for all status types
- ✅ Q number search is case-insensitive
- ✅ Reset filters clears all active filters
- ✅ Expandable rows show line item details
- ✅ Links to PO detail pages work correctly
- ✅ Currency formatting matches other pages (ZAR with formatCurrency())
- ✅ Progress bars display correctly
- ✅ Summary totals calculate correctly

### Reports Tab
- ✅ All statistics cards display correct values
- ✅ Total Orders count is accurate
- ✅ Total Order Value sums correctly
- ✅ Outstanding Orders identifies partially received orders
- ✅ Average Lead Time calculates from actual receipt data
- ✅ On-Time Delivery Rate handles missing lead_time data gracefully (N/A)
- ✅ Unique Components counts distinct components
- ✅ Orders by Status groups and displays correctly
- ✅ Recent Purchase Orders shows last 10 with links
- ✅ Date range filter updates all statistics
- ✅ Empty state displays when no orders exist

## Code References

- **Orders Tab Implementation:** `components/features/suppliers/supplier-orders.tsx`
- **Reports Tab Implementation:** `components/features/suppliers/supplier-reports.tsx`
- **Type Definitions:** `types/suppliers.ts:47-87`
- **Page Integration:** `app/suppliers/[id]/page.tsx:17-18,140-141,175-185`
- **Date Filtering Pattern:** `app/purchasing/purchase-orders/page.tsx:268-289`
- **Currency Formatting:** `lib/quotes.ts:308`

## UI Patterns

### Toolbar Styling
```typescript
className="flex flex-col gap-3 p-3 bg-card rounded-xl border shadow-sm md:flex-row md:items-center md:justify-between"
```

### Statistics Cards
```typescript
className="p-6 bg-card rounded-xl border shadow-sm"
```

### Date Pickers
Uses `@/components/ui/calendar` with `Popover` and `PopoverTrigger` pattern consistent with Purchase Orders page.

### Status Badges
Reuses same badge logic as Purchase Orders:
- Draft: `outline`
- Pending Approval: `secondary`
- Approved: `default`
- Partially Received: `secondary`
- Fully Received: `default`
- Cancelled: `destructive`

## Performance Considerations

- **Client-side filtering**: All filtering happens after fetching orders. For suppliers with 100+ orders, consider server-side filtering.
- **Lazy loading**: Both tabs use React.lazy() and Suspense for optimal initial page load
- **Query caching**: React Query caches supplier purchase order data with query key `['supplier-purchase-orders', supplier_id]`
- **Memoization**: All filtering and statistics calculations use useMemo for performance

## Future Enhancements

- Add charts/visualizations for order trends over time
- Add export functionality for reports (CSV/PDF)
- Add comparison with previous period for statistics
- Server-side pagination for Orders tab for suppliers with many orders
- Add filters for specific components in Orders tab
- Add download option for line item details






