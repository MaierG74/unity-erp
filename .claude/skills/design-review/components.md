# Component Patterns Reference

Actual Tailwind classes and patterns from the Unity ERP codebase. Use these as the source of truth.

## PageToolbar (Modern Page Header)

**File:** `components/ui/page-toolbar.tsx`
**Usage:** Preferred for all page headers. Provides title, optional search, and action buttons.

```tsx
<PageToolbar
  title="Page Name"
  subtitle="Optional description"
  searchPlaceholder="Search..."
  searchValue={search}
  onSearchChange={setSearch}
  actions={[
    { label: 'New Item', onClick: handleNew, icon: <PlusCircle className="h-4 w-4" /> },
    { label: 'Export', onClick: handleExport, variant: 'outline', icon: <Download className="h-4 w-4" /> },
  ]}
>
  {/* Optional children: filters, dropdowns */}
</PageToolbar>
```

**Container classes:** `py-2 px-0 flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-border/50 mb-4`
**Title:** `text-xl font-semibold tracking-tight text-foreground`
**Search input:** `h-9 pl-9 pr-9 focus:ring-2 focus:ring-primary/20 focus:border-primary`
**Action buttons:** `h-9 px-4` with `size="sm"`, collapse to dropdown on mobile when >2 buttons

**Pages using PageToolbar:** inventory, staff, suppliers
**Pages NOT yet using it (legacy headers):** purchasing, quotes, orders — these use manual flex layouts

## Metric/KPI Cards

**Reference:** `app/purchasing/page.tsx` lines 326-365

```tsx
<div className="grid gap-4 md:grid-cols-3">
  <Card className={cn(
    'border-l-4 transition-all duration-200 cursor-pointer hover:shadow-md',
    card.borderColor, // e.g. 'border-l-primary', 'border-l-warning'
    isActive && 'ring-2 ring-primary/50 bg-primary/10 shadow-md'
  )}>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{label}</CardTitle>
      <Icon className={cn('h-4 w-4', card.iconColor)} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </CardContent>
  </Card>
</div>
```

**Active state:** `ring-2 ring-primary/50 shadow-md` + background tint (`bg-primary/10` or `bg-warning/10`)
**Inactive hover:** `hover:shadow-md`
**Left border colors:** `border-l-primary` (active/approved), `border-l-muted-foreground` (neutral), `border-l-warning` (caution)

## Data Tables

**File:** `components/ui/table.tsx`

| Component | Key Classes |
|---|---|
| `Table` | `w-full caption-bottom text-sm` in overflow container |
| `TableHeader` | `[&_tr]:border-b sticky top-0 bg-background z-10` |
| `TableHead` | `h-12 px-4 text-left align-middle font-medium text-muted-foreground` |
| `TableRow` | `border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted` |
| `TableCell` | `px-4 py-2.5 align-middle` |

**Row height target:** 52-56px (industry norm for ERP: Odoo 40-48px, SAP Fiori 44px)
**Two-line content rows** (component name + description) are acceptable at 56-60px.

### Desktop + Mobile Pattern

```tsx
{/* Desktop table */}
<div className="hidden md:block">
  <Table>...</Table>
</div>

{/* Mobile cards */}
<div className="md:hidden space-y-3">
  {items.map(item => (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      ...compact card layout...
    </div>
  ))}
</div>
```

## Buttons

**File:** `components/ui/button.tsx`

| Variant | Classes | Usage |
|---|---|---|
| `default` | `bg-primary text-primary-foreground hover:bg-primary/90` | Primary CTAs |
| `destructive` | `bg-destructive text-destructive-foreground` | Delete, critical |
| `destructiveSoft` | `bg-destructive/15 text-destructive border border-destructive/20` | Soft delete |
| `outline` | `border border-input bg-background hover:bg-accent` | Secondary actions |
| `secondary` | `bg-secondary text-secondary-foreground` | Muted actions |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` | Minimal, inline |
| `link` | `text-primary underline-offset-4 hover:underline` | Text links |

| Size | Classes |
|---|---|
| `default` | `h-10 px-4 py-2` |
| `sm` | `h-9 rounded-md px-3` |
| `lg` | `h-11 rounded-md px-8` |
| `icon` | `h-10 w-10` |

**Convention:** Use `size="sm"` (`h-9`) for toolbar/filter buttons. Use default (`h-10`) for standalone CTAs.

## Badges

**File:** `components/ui/badge.tsx`

| Variant | Classes | Usage |
|---|---|---|
| `default` | `bg-primary text-primary-foreground` | Approved status |
| `secondary` | `bg-secondary text-secondary-foreground` | Partially Received, muted states |
| `destructive` | `bg-destructive text-destructive-foreground` | Cancelled, errors |
| `outline` | `text-foreground` (border only) | Supplier tags, neutral labels |
| `success` | `bg-green-500 text-white` | Fully Received, completed |
| `warning` | `bg-amber-500 text-white` | Pending, draft |

**Base classes:** `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold`

### Status Badge Consistency

Use these mappings everywhere (list views AND detail views):
| Status | Badge Variant |
|---|---|
| Draft | `warning` or `secondary` |
| Pending Approval | `warning` |
| Approved | `default` (primary teal) |
| Partially Received | `secondary` (slate) |
| Fully Received | `success` (green) |
| Cancelled | `destructive` (red) |

## Card Component

**File:** `components/ui/card.tsx`

| Component | Key Classes |
|---|---|
| `Card` | `rounded-lg border bg-card p-6 text-card-foreground shadow-sm` |
| `CardHeader` | `flex flex-col space-y-1.5 p-6` |
| `CardTitle` | `text-2xl font-semibold leading-none tracking-tight` |
| `CardDescription` | `text-sm text-muted-foreground` |
| `CardContent` | `p-6 pt-0` |
| `CardFooter` | `flex items-center p-6 pt-0` |

## Empty States

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <Icon className="h-12 w-12 text-green-500 mb-3" />
  <p className="text-lg font-medium">Title message</p>
  <p className="text-sm text-muted-foreground mt-1">Helpful description</p>
  <Button variant="outline" className="mt-4">CTA</Button>
</div>
```

## Pagination

```tsx
<div className="flex items-center justify-between">
  <p className="text-sm text-muted-foreground">
    Showing {shown} of {total} item{total !== 1 ? 's' : ''}
  </p>
  <div className="flex items-center gap-2">
    <Select value={String(pageSize)} onValueChange={...}>
      <SelectTrigger className="h-9 w-28" />
    </Select>
    <Button variant="outline" size="sm" className="h-9">
      <ChevronLeft className="h-4 w-4" />
    </Button>
    <div className="text-sm w-16 text-center">{page} / {totalPages}</div>
    <Button variant="outline" size="sm" className="h-9">
      <ChevronRight className="h-4 w-4" />
    </Button>
  </div>
</div>
```

### URL-Based State Persistence

**Reference:** `components/features/inventory/ComponentsTab.tsx`

Persist pagination and filters in URL query parameters so users return to the same page when navigating back from detail pages.

**1. Initialize state from URL parameters:**
```tsx
const searchParams = useSearchParams();
const [currentPage, setCurrentPage] = useState(() => {
  const pageParam = searchParams?.get('page');
  return pageParam ? parseInt(pageParam, 10) - 1 : 0; // Convert to 0-based
});
const [pageSize, setPageSize] = useState(() => {
  const sizeParam = searchParams?.get('pageSize');
  return sizeParam ? parseInt(sizeParam, 10) : 10;
});
const [filterText, setFilterText] = useState(() => searchParams?.get('q') || '');
const [selectedCategory, setSelectedCategory] = useState(() =>
  searchParams?.get('category') || '_all'
);
```

**2. Sync changes to URL:**
```tsx
useEffect(() => {
  const params = new URLSearchParams(searchParams?.toString() || '');

  // Update filters
  if (filterText) params.set('q', filterText);
  else params.delete('q');

  if (selectedCategory !== '_all') params.set('category', selectedCategory);
  else params.delete('category');

  // Update pagination (only include if not default)
  if (currentPage > 0) params.set('page', (currentPage + 1).toString());
  else params.delete('page');

  if (pageSize !== 10) params.set('pageSize', pageSize.toString());
  else params.delete('pageSize');

  const query = params.toString();
  const url = query ? `/inventory?${query}` : '/inventory';
  router.replace(url, { scroll: false });
}, [filterText, selectedCategory, currentPage, pageSize, router, searchParams]);
```

**3. Reset to page 1 when filters change:**
```tsx
// In filter change handlers
const handleCategoryChange = (value: string) => {
  setSelectedCategory(value);
  setCurrentPage(0); // Reset to first page
};
```

**4. Use controlled DataTable:**
```tsx
<DataTable
  data={filteredData}
  pageIndex={currentPage}
  pageSize={pageSize}
  onPageChange={setCurrentPage}
  onPageSizeChange={setPageSize}
  // ... other props
/>
```

**Benefits:**
- Users return to the exact page + filters after viewing details
- Shareable URLs with filters applied
- Browser back/forward works correctly
- Clean URLs (default values omitted)

## Loading States

**Skeleton:** `<Skeleton className="h-8 w-16" />` (adjust size per context)
**Spinner:** `<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />`
**Loader2 icon:** `<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />`
