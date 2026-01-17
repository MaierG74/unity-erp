# Inventory URL Filter Persistence

**Date**: 2026-01-17

## Summary

Implemented URL-based filter persistence for the Inventory page. Filters (search, category, supplier) and active tab are now stored in URL query parameters, allowing them to survive navigation to detail pages and back.

## Problem

When users filtered the inventory list and clicked on a component to view its details, clicking the back button would reset all filters. Users had to re-apply filters repeatedly, which was frustrating when reviewing multiple items matching specific criteria.

## Solution

Adopted the URL query parameter pattern (already used in Quotes and Suppliers pages) to persist filter state in the URL.

**Example URL**: `/inventory?q=bracket&category=Hardware&supplier=ACR&tab=components`

## Changes

### Files Modified

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

## Testing

1. Navigate to `/inventory`
2. Select a category (e.g., "Arm")
3. Observe URL changes to `/inventory?category=Arm`
4. Click on a component to view details
5. Click the back arrow
6. Verify: category filter is still set to "Arm"

## Related Documentation

- [`docs/technical/url-filter-persistence.md`](../technical/url-filter-persistence.md) - Pattern documentation for system-wide rollout
