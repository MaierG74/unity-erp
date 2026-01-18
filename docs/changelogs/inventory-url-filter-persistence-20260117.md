# URL Filter Persistence (Inventory, Quotes, Customers, Orders & Suppliers)

**Date**: 2026-01-17

## Summary

Implemented and fixed URL-based filter persistence for the Inventory, Quotes, Customers, Orders, and Suppliers pages. Filters are now stored in URL query parameters, allowing them to survive navigation to detail pages and back.

## Problem

When users filtered the inventory list and clicked on a component to view its details, clicking the back button would reset all filters. Users had to re-apply filters repeatedly, which was frustrating when reviewing multiple items matching specific criteria.

## Solution

Adopted the URL query parameter pattern (already used in Quotes and Suppliers pages) to persist filter state in the URL.

**Example URL**: `/inventory?q=bracket&category=Hardware&supplier=ACR&tab=components`

## Changes

### Inventory Files Modified

1. **`app/inventory/page.tsx`**
   - Added `useSearchParams` and `useRouter` hooks
   - Changed Tabs from uncontrolled (`defaultValue`) to controlled (`value`)
   - Added `handleTabChange` to sync tab changes to URL
   - Tab parameter stored as `?tab=components|categories|overhead|...`

2. **`components/features/inventory/ComponentsTab.tsx`**
   - Added `useSearchParams` hook
   - Initialize filter state from URL params with lazy initializers
   - Added `useEffect` to sync filter changes back to URL
   - Uses debounced search value to avoid URL spam
   - Stores: `q` (search), `category`, `supplier`

3. **`app/inventory/components/[id]/page.tsx`**
   - Changed back button from `<Link href="/inventory">` to `onClick={() => router.back()}`
   - Removed unused `Link` import

### Quotes Files Modified

4. **`app/quotes/page.tsx`**
   - Changed URL param initialization effect dependency from `[]` to `[searchParamsString]`
   - This ensures filters are re-read from URL when navigating back (component doesn't remount)

5. **`components/quotes/EnhancedQuoteEditor.tsx`**
   - Simplified `handleBack()` to just use `router.back()` instead of complex `document.referrer` logic
   - The referrer-based approach was unreliable with client-side navigation

### Customers Files Modified

6. **`app/customers/page.tsx`**
   - Added `useSearchParams` and `useDebounce` hooks
   - Initialize `searchQuery` from URL params
   - Added effect to sync search changes to URL with debouncing
   - Added effect to re-read URL params on back navigation

7. **`app/customers/[id]/page.tsx`**
   - Changed `handleBack()` to use `router.back()` instead of `router.push('/customers')`
   - Updated `handleDiscardChanges()` to handle 'back' navigation with `router.back()`
   - Preserves unsaved changes detection while supporting filter persistence

### Orders Files Modified

8. **`app/orders/page.tsx`**
   - Added `useSearchParams` and `useDebounce` hooks
   - Initialize `statusFilter`, `searchQuery`, and `activeSection` from URL params
   - Replaced custom `window.searchTimeout` debounce with `useDebounce` hook
   - Added effect to sync filter changes to URL
   - Added effect to re-read URL params on back navigation
   - Stores: `q` (search), `status`, `section`

9. **`app/orders/[orderId]/page.tsx`**
   - Changed back button from `<Link href="/orders">` to `onClick={() => router.back()}`
   - Removed unused `Link` import

### Suppliers Files Modified

10. **`components/features/suppliers/supplier-list.tsx`**
    - Added `useDebounce` hook
    - Initialize `searchTerm` from URL params (was not persisted before)
    - Added effect to sync search and pricelist filter to URL
    - Added effect to re-read URL params on back navigation
    - Stores: `q` (search), `hasPricelist`

11. **`app/suppliers/[id]/page.tsx`**
    - Changed all back buttons from `<Link href="/suppliers">` to `onClick={() => router.back()}`
    - Removed unused `Link` import

## Testing

### Inventory
1. Navigate to `/inventory`
2. Select a category (e.g., "Arm")
3. Observe URL changes to `/inventory?category=Arm`
4. Click on a component to view details
5. Click the back arrow
6. Verify: category filter is still set to "Arm"

### Quotes
1. Navigate to `/quotes`
2. Search for a customer (e.g., "Woodlam")
3. Observe URL changes to `/quotes?q=Woodlam`
4. Click on a quote to view details
5. Click "Back to Quotes"
6. Verify: search filter still shows "Woodlam" and filtered results

### Customers
1. Navigate to `/customers`
2. Search for a customer (e.g., "Woodlam")
3. Observe URL changes to `/customers?q=Woodlam`
4. Click on a customer to view details
5. Click the back arrow
6. Verify: search filter still shows "Woodlam" and filtered results

### Orders
1. Navigate to `/orders`
2. Filter by status (e.g., "In Progress")
3. Observe URL changes to `/orders?status=In Progress`
4. Click on a section filter (e.g., "Wood Section")
5. Observe URL changes to `/orders?status=In Progress&section=wood`
6. Click on an order to view details
7. Click the back arrow
8. Verify: both status and section filters are still active

### Suppliers
1. Navigate to `/suppliers`
2. Search for a supplier name (e.g., "ACR")
3. Observe URL changes to `/suppliers?q=ACR`
4. Optionally check "Has price list" checkbox
5. Observe URL changes to `/suppliers?q=ACR&hasPricelist=1`
6. Click on a supplier to view details
7. Click "Back to Suppliers"
8. Verify: search filter and checkbox state are preserved

## Related Documentation

- [`docs/technical/url-filter-persistence.md`](../technical/url-filter-persistence.md) - Pattern documentation for system-wide rollout
