# Todo Entity Link Picker Fix - 2025-10-09

## Summary
Fixed the entity link picker in the todo module to properly search and select orders, quotes, and supplier orders. The picker now successfully loads data from the API and allows clicking to select records.

## Issues Fixed

### 1. API Route Syntax Errors
**Problem**: The entity-links API route had multiple Supabase query syntax errors causing 500 Internal Server Error responses.

**Root Causes**:
- Using `supabaseAdmin` client without SUPABASE_SERVICE_ROLE_KEY environment variable
- Incorrect Supabase join syntax with alias notation that wasn't properly reassigning query chains
- Invalid PostgreSQL text casting syntax in `.or()` filters
- Incorrect foreign key relationship paths (supplier_orders → suppliers doesn't exist)

**Fixes Applied**:

#### a) Changed from Admin Client to Authenticated Client
```typescript
// BEFORE: Using supabaseAdmin (requires service role key)
import { supabaseAdmin } from '@/lib/supabase-admin';
const ordersPromise = supabaseAdmin.from('orders')...

// AFTER: Using authenticated route client
import { getRouteClient } from '@/lib/supabase-route';
const ctx = await getRouteClient(req);
const ordersQuery = ctx.supabase.from('orders')...
```

#### b) Fixed Query Chain Immutability
Supabase query methods return new query objects, so conditional filters must reassign:

```typescript
// BEFORE: Mutating query chain (doesn't work)
const ordersPromise = ctx.supabase.from('orders').select(...).order(...).limit(...);
if (search) {
  ordersPromise.or(`order_number.ilike.${likeTerm}`); // Lost!
}

// AFTER: Reassigning query chain
let ordersQuery = ctx.supabase.from('orders').select(...).order(...).limit(...);
if (search) {
  ordersQuery = ordersQuery.or(`order_number.ilike.${likeTerm}`); // Captured!
}
```

#### c) Fixed Join Syntax
Changed from alias syntax to proper nested selects:

```typescript
// BEFORE: Alias syntax (caused relationship errors)
.select('order_id, customer:customers(name), status:order_statuses(status_name)')

// AFTER: Proper nested select syntax
.select('order_id, customer_id, customers(name), order_statuses(status_name)')

// Access in mapping:
// BEFORE: order.customer?.name
// AFTER: order.customers?.name
```

#### d) Fixed Supplier Orders Relationship Path
The `supplier_orders` table doesn't have a direct foreign key to `suppliers` - it goes through `suppliercomponents`:

```sql
-- Foreign key chain:
supplier_orders.supplier_component_id → suppliercomponents.supplier_component_id
suppliercomponents.supplier_id → suppliers.id
```

```typescript
// BEFORE: Direct relationship (doesn't exist)
.select('order_id, supplier_id, suppliers(name), supplier_order_statuses(status_name)')

// AFTER: Nested through suppliercomponents
.select('order_id, supplier_component_id, suppliercomponents(supplier_id, suppliers(name)), supplier_order_statuses(status_name)')

// Mapping updated:
meta: {
  supplier: po.suppliercomponents?.suppliers?.name ?? null,
  status: po.supplier_order_statuses?.status_name ?? null,
  orderDate: po.order_date ?? null,
}
```

#### e) Removed Invalid PostgreSQL Cast in Filter
```typescript
// BEFORE: Invalid syntax for .or() filter
supplierOrdersQuery.or(`order_id::text.ilike.${likeTerm}`);
// Error: unexpected "d" expecting "(" in logic tree

// AFTER: Removed search filter for numeric order_id
// Only orders (by order_number) and quotes (by quote_number) are searchable
const supplierOrdersQuery = ctx.supabase
  .from('supplier_orders')
  .select('...')
  .order('order_date', { ascending: false })
  .limit(limit);
// No search filter applied
```

### 2. CommandItem Not Clickable
**Problem**: Items in the CommandDialog were displaying but not responding to clicks.

**Root Causes**:
- Missing `value` prop on `CommandItem` (required by cmdk library)
- `cursor-default` class preventing proper click indication
- Missing fallback `onClick` handler

**Fixes Applied**:

#### a) Added Required `value` Prop
```typescript
// BEFORE: No value prop
<CommandItem
  key={`${link.type}-${link.id}`}
  onSelect={() => { ... }}
>

// AFTER: Unique value prop required by cmdk
<CommandItem
  key={`${link.type}-${link.id}`}
  value={`${link.type}-${link.id}-${link.label}`}
  onSelect={() => { ... }}
>
```

#### b) Changed Cursor Style
Updated `components/ui/command.tsx`:
```typescript
// BEFORE:
className={cn(
  "relative flex cursor-default select-none items-center ...",
  className
)}

// AFTER:
className={cn(
  "relative flex cursor-pointer select-none items-center ...",
  className
)}
```

#### c) Added Fallback onClick Handler
```typescript
<CommandItem
  value={`${link.type}-${link.id}-${link.label}`}
  onSelect={() => {
    console.log('[TodoEntityLinkPicker] onSelect fired for:', link);
    onSelect(link);
    onOpenChange(false);
  }}
  onClick={() => {
    console.log('[TodoEntityLinkPicker] onClick fired for:', link);
    onSelect(link);
    onOpenChange(false);
  }}
>
```

### 3. Enhanced Error Logging
Added detailed console logging for debugging:

```typescript
// In API route:
if (ordersError) {
  console.error('[entity-links][GET] Orders query failed:', ordersError);
  throw ordersError;
}
if (supplierError) {
  console.error('[entity-links][GET] Supplier orders query failed:', supplierError);
  throw supplierError;
}
if (quotesError) {
  console.error('[entity-links][GET] Quotes query failed:', quotesError);
  throw quotesError;
}

// In React component:
useEffect(() => {
  if (open) {
    console.log('[TodoEntityLinkPicker] Data:', data);
    console.log('[TodoEntityLinkPicker] Loading:', isLoading);
    console.log('[TodoEntityLinkPicker] Error:', error);
    console.log('[TodoEntityLinkPicker] Query:', query);
  }
}, [data, isLoading, error, query, open]);
```

## Files Changed

### 1. `/app/api/entity-links/route.ts`
- Switched from `supabaseAdmin` to `ctx.supabase` authenticated client
- Fixed query chain immutability by reassigning filtered queries
- Updated join syntax from alias notation to proper nested selects
- Fixed supplier_orders relationship path through suppliercomponents
- Removed invalid PostgreSQL cast in supplier orders search
- Added detailed error logging for each query type
- Updated response mapping to access nested relationships correctly

### 2. `/components/features/todos/TodoEntityLinkPicker.tsx`
- Added required `value` prop to CommandItem components
- Added onClick handler as fallback to onSelect
- Added console logging for debugging selection events
- Maintained existing debug logging for data/loading/error states

### 3. `/components/ui/command.tsx`
- Changed CommandItem cursor from `cursor-default` to `cursor-pointer`
- No other changes to base component

## Database Schema Reference

### Foreign Key Relationships Used
```sql
-- orders table
orders.customer_id → customers.id
orders.status_id → order_statuses.status_id

-- supplier_orders table
supplier_orders.supplier_component_id → suppliercomponents.supplier_component_id
supplier_orders.status_id → supplier_order_statuses.status_id

-- suppliercomponents table (junction)
suppliercomponents.supplier_id → suppliers.id

-- quotes table
quotes.customer_id → customers.id
```

## Testing Notes

### Manual Testing Steps
1. Navigate to `/todos`
2. Click on any todo item to open detail dialog
3. Click "Select record" button under "Linked record" section
4. CommandDialog opens with search input
5. Initially shows all orders, supplier orders, and quotes (limit 20 each)
6. Type search query (e.g., "test", "apollo")
7. Results filter to matching order_number or quote_number
8. Hover over items - cursor shows pointer
9. Click on any item
10. Dialog closes and item is selected
11. "Linked record" section shows selected item details

### Known Limitations
- Supplier orders are NOT searchable by order_id (numeric field)
- Only orders (by order_number) and quotes (by quote_number) support text search
- Search does not currently search by customer name or supplier name (could be added)
- Results limited to 20 per entity type (configurable via limit parameter)

## Performance Considerations

### API Query Performance
- Three parallel queries executed via `Promise.all()` (orders, supplier_orders, quotes)
- Each query limited to 20 results by default (max 100)
- Indexes should exist on:
  - `orders.order_number` (for text search)
  - `quotes.quote_number` (for text search)
  - `orders.created_at` (for sorting)
  - `supplier_orders.order_date` (for sorting)
  - `quotes.created_at` (for sorting)

### RLS Policies Required
All tables must have SELECT RLS policies for authenticated users:
- `orders` - user must have read access
- `quotes` - user must have read access
- `supplier_orders` - user must have read access
- `customers` - user must have read access (for joins)
- `suppliers` - user must have read access (for joins)
- `order_statuses` - user must have read access (for joins)
- `supplier_order_statuses` - user must have read access (for joins)
- `suppliercomponents` - user must have read access (for joins)

## Future Enhancements

### Potential Improvements
1. **Add customer/supplier name search**: Extend `.or()` filters to include joined table fields
2. **Add supplier order search**: Create a computed text field or use full-text search
3. **Pagination**: Add infinite scroll or "Load more" button for >20 results per type
4. **Debounce search input**: Add 300ms debounce to reduce API calls while typing
5. **Cache results**: Use React Query's cache to avoid refetching on dialog reopen
6. **Keyboard navigation**: Ensure arrow keys work properly (cmdk should handle this)
7. **Recent/favorite links**: Show recently linked or frequently used records first
8. **Type filtering**: Add toggle to show only orders, only quotes, etc.

## Related Documentation
- [Todo Module Documentation](../domains/todos/README.md)
- [Entity Links API](../api/entity-links.md) (if exists)
- [Style Guide - Command Pattern](../overview/STYLE_GUIDE.md)
- [Supabase Query Patterns](../technical/supabase-patterns.md) (if exists)

## Changelog Entry
**Date**: 2025-10-09
**Type**: Bug Fix
**Module**: Todo Module - Entity Link Picker
**Impact**: High - Feature was completely broken, now functional
**Breaking Changes**: None
**Migration Required**: No
