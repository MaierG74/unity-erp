# URL-Based Filter Persistence Pattern

This document describes the pattern for persisting filter state in URL query parameters, enabling filters to survive navigation between list and detail pages.

## Problem

When a user:
1. Filters a list (e.g., inventory components by supplier)
2. Clicks on an item to view its detail page
3. Clicks the back button to return to the list

**Previous behavior**: Filters reset to defaults, forcing the user to re-apply them.

**Desired behavior**: Filters are preserved, and the user returns to exactly where they were.

## Solution: URL Query Parameters

Store filter state in URL query parameters (e.g., `/inventory?category=Bracket&supplier=ACR&q=search`). This provides:

- **Automatic persistence** through browser history
- **Shareable URLs** (copy a filtered view to share with colleagues)
- **Refresh survival** (filters persist if page is refreshed)
- **Browser back/forward** works correctly
- **No extra state management** required

## Implementation Pattern

### 1. List Page Component

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebounce } from '@/hooks/use-debounce';

export function MyListComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize state from URL parameters
  const [searchText, setSearchText] = useState(() => searchParams?.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState(() => searchParams?.get('category') || '_all');
  const [selectedStatus, setSelectedStatus] = useState(() => searchParams?.get('status') || '_all');

  // Debounce search input to avoid excessive URL updates
  const debouncedSearchText = useDebounce(searchText, 300);

  // Sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() || '');

    // Update search query (use debounced value)
    if (debouncedSearchText) {
      params.set('q', debouncedSearchText);
    } else {
      params.delete('q');
    }

    // Update category filter
    if (selectedCategory && selectedCategory !== '_all') {
      params.set('category', selectedCategory);
    } else {
      params.delete('category');
    }

    // Update status filter
    if (selectedStatus && selectedStatus !== '_all') {
      params.set('status', selectedStatus);
    } else {
      params.delete('status');
    }

    // Build URL and update (use replace to avoid history spam)
    const query = params.toString();
    const url = query ? `/my-page?${query}` : '/my-page';
    router.replace(url, { scroll: false });
  }, [debouncedSearchText, selectedCategory, selectedStatus, router, searchParams]);

  // ... rest of component
}
```

### 2. Parent Page with Tabs (Optional)

If the page has tabs, also persist the active tab in the URL:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const VALID_TABS = ['items', 'categories', 'reports'] as const;
type ValidTab = typeof VALID_TABS[number];

export default function MyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active tab from URL, defaulting to first tab
  const tabParam = searchParams?.get('tab');
  const activeTab: ValidTab = VALID_TABS.includes(tabParam as ValidTab)
    ? (tabParam as ValidTab)
    : 'items';

  // Handle tab change - update URL while preserving other params
  const handleTabChange = (newTab: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');

    if (newTab === 'items') {
      // Default tab - remove from URL to keep it clean
      params.delete('tab');
    } else {
      params.set('tab', newTab);
    }

    const query = params.toString();
    const url = query ? `/my-page?${query}` : '/my-page';
    router.replace(url, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="items">Items</TabsTrigger>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="reports">Reports</TabsTrigger>
      </TabsList>
      {/* TabsContent... */}
    </Tabs>
  );
}
```

### 3. Detail Page Back Navigation

Change the back button to use `router.back()` instead of a hard-coded Link:

```tsx
// BEFORE (resets filters)
<Button variant="outline" size="icon" asChild>
  <Link href="/my-page">
    <ArrowLeft className="h-4 w-4" />
  </Link>
</Button>

// AFTER (preserves filters via browser history)
<Button variant="outline" size="icon" onClick={() => router.back()}>
  <ArrowLeft className="h-4 w-4" />
</Button>
```

**Important**: Remove the `Link` import if it's no longer used in the file.

## URL Parameter Conventions

| Parameter | Purpose | Example Values |
|-----------|---------|----------------|
| `q` | Search/filter text | `q=bracket` |
| `category` | Category filter | `category=Hardware` |
| `supplier` | Supplier filter | `supplier=ACR` |
| `status` | Status filter | `status=active` |
| `tab` | Active tab | `tab=reports` |
| `page` | Pagination | `page=2` |
| `sort` | Sort order | `sort=name_asc` |

### Naming Guidelines

- Use lowercase parameter names
- Use underscores for multi-word values: `sort=created_desc`
- Use `_all` as the "no filter" value (not stored in URL)
- URL-encode special characters (handled automatically by `URLSearchParams`)

## Pages to Update

### Priority 1: High-Traffic List Pages

| Page | Route | Filters to Persist |
|------|-------|-------------------|
| ✅ Inventory | `/inventory` | `q`, `category`, `supplier`, `tab` |
| ✅ Quotes | `/quotes` | `q`, `status`, `sort`, `page`, `pageSize` |
| ✅ Customers | `/customers` | `q` |
| ✅ Orders | `/orders` | `q`, `status`, `section` |
| ✅ Suppliers | `/suppliers` | `q`, `hasPricelist` |
| Products | `/products` | `q`, `category` |
| Purchase Orders | `/purchasing/purchase-orders` | `q`, `status`, `supplier` |

### Priority 2: Secondary Pages

| Page | Route | Filters to Persist |
|------|-------|-------------------|
| Staff | `/staff` | `q`, `department` |
| Time & Attendance | `/attendance` | `date`, `employee` |

## Implementation Checklist

For each page, complete these steps:

### List Component
- [ ] Add `useSearchParams` import from `next/navigation`
- [ ] Initialize filter state from URL params with lazy initializers
- [ ] Add `useEffect` to sync filter changes to URL
- [ ] Use `router.replace()` with `{ scroll: false }` to avoid scroll jumps
- [ ] Debounce text inputs (300ms recommended)
- [ ] Remove default values from URL (keep URLs clean)

### Parent Page (if tabbed)
- [ ] Add `useSearchParams` and `useRouter` imports
- [ ] Read active tab from URL with validation
- [ ] Change `<Tabs>` from `defaultValue` to controlled `value`
- [ ] Add `onValueChange` handler to update URL

### Detail Page
- [ ] Change back button from `<Link>` to `onClick={() => router.back()}`
- [ ] Remove unused `Link` import if applicable
- [ ] Ensure `useRouter` is imported

### Testing
- [ ] Filter list, click item, click back → filters preserved
- [ ] Filter list, refresh page → filters preserved
- [ ] Copy URL, paste in new tab → filters applied
- [ ] Browser back/forward buttons work correctly
- [ ] Clear filters returns to clean URL

## Existing Implementations (Reference)

These files already implement the pattern and can be used as reference:

1. **Quotes Page**: `app/quotes/page.tsx` + `components/quotes/EnhancedQuoteEditor.tsx`
   - Full implementation with search, status, sort, pagination
   - **Key fix**: Changed `useEffect` dependency from `[]` to `[searchParamsString]` to re-read URL on back navigation
   - **Key fix**: Simplified `handleBack()` to just use `router.back()` instead of conditional referrer checking

2. **Supplier List**: `components/features/suppliers/supplier-list.tsx`
   - Simple implementation with checkbox filter

3. **Inventory (new)**: `app/inventory/page.tsx` + `components/features/inventory/ComponentsTab.tsx`
   - Tab management + multi-filter implementation

4. **Customers**: `app/customers/page.tsx` + `app/customers/[id]/page.tsx`
   - Search filter with unsaved changes detection on detail page

5. **Orders**: `app/orders/page.tsx` + `app/orders/[orderId]/page.tsx`
   - Status filter, search filter, section filter (section pills for product categories)

6. **Suppliers**: `components/features/suppliers/supplier-list.tsx` + `app/suppliers/[id]/page.tsx`
   - Search filter, "has pricelist" checkbox filter

## Troubleshooting

### Filters not persisting on back navigation
- Ensure detail page uses `router.back()` not `<Link href="...">` or `router.push('/path')`
- Check that URL is being updated on filter change
- **Common issue**: The initialization effect has `[]` dependency array (runs only on mount)
  - Fix: Add `searchParams` or `searchParamsString` to the dependency array so it re-runs when URL changes

### URL updates cause scroll to top
- Add `{ scroll: false }` to `router.replace()` call

### Filters reset on component re-render
- Use lazy initializers: `useState(() => searchParams?.get('q') || '')`
- Not: `useState(searchParams?.get('q') || '')`

### Multiple rapid URL updates
- Debounce text inputs using `useDebounce` hook
- Only update URL when debounced value changes

### TypeScript errors with searchParams
- Use optional chaining: `searchParams?.get('q')`
- searchParams can be null in some contexts

## Related Files

- `hooks/use-debounce.ts` - Debounce hook for search inputs
- `components/ui/tabs.tsx` - Radix UI tabs component
