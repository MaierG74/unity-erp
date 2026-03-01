# Orders Page UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the order detail page from a single-scroll accordion layout to real content-switching tabs, add a two-column overview, improve light mode readability, and add issuance status to the orders list.

**Architecture:** In-place tab conversion (Approach A). Replace the scroll-anchor SmartButtonsRow and CollapsibleSection wrappers with real tab switching using client-side state + `?tab=` URL sync. Reuse all existing tab content components as-is. Add a two-column layout for the Products/Overview tab with a right sidebar showing customer docs and order progress.

**Tech Stack:** Next.js App Router, React Query, shadcn/ui (Tabs component exists at `components/ui/tabs.tsx`), Tailwind CSS, Supabase.

**Design doc:** `docs/plans/2026-03-01-orders-page-ux-overhaul-design.md`

---

## Task 1: Convert SmartButtonsRow to a Real Tab Bar

**Goal:** Replace the scroll-anchor smart buttons with a proper tab bar that switches content.

**Files:**
- Modify: `components/features/orders/SmartButtonsRow.tsx`
- Modify: `app/orders/[orderId]/page.tsx`

### Step 1: Restyle SmartButtonsRow as a tab bar

The current SmartButtonsRow renders badge-like buttons in a flex row. Convert the styling to look like a tab bar with bottom-border indicators instead of pill/ring styles.

In `SmartButtonsRow.tsx`:
- Keep the same props interface (counts + activeSection + onButtonClick)
- Change the container to include a bottom border: `border-b`
- Change each button's active style from ring highlight to `border-b-2 border-primary text-primary font-medium`
- Inactive tabs: `text-muted-foreground hover:text-foreground`
- Remove the pill/badge outer styling, keep the icon + label + count layout
- Keep count display as `(N)` inline with label

### Step 2: Wire tab state to URL search params

In `app/orders/[orderId]/page.tsx`:
- `useSearchParams` is already imported (line 17) and instantiated (line 76)
- Replace `activeSection` state (line 73) with a derived value from search params:
  ```tsx
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'products';
  ```
- Replace `handleSmartButtonClick` (lines 104-128) with:
  ```tsx
  const handleTabChange = useCallback((tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);
  ```
- Pass `activeTab` and `handleTabChange` to SmartButtonsRow (rename props: `activeSection` → `activeTab`, `onButtonClick` → `onTabChange`)

### Step 3: Remove accordion/collapsible infrastructure

In `app/orders/[orderId]/page.tsx`:
- Remove `openSections` state (lines 95-99)
- Remove `collapsibleIds` Set (line 102)
- Remove section refs that were only used for scroll-to: `jobCardsRef`, `procurementRef`, `documentsRef`, `issueStockRef` (lines 88-91). Keep `productsRef` and `componentsRef` since they mark non-tab content positions.
- Remove the entire collapsible sections array + reordering logic (lines 1218-1272)
- Remove the `CollapsibleSection` import (line 47)

### Step 4: Render tab content conditionally

Replace the collapsible sections block (lines 1218-1272) with conditional rendering:

```tsx
{/* Tab Content */}
{activeTab === 'products' && (
  <ProductsOverviewTab ... /> {/* Built in Task 3 */}
)}
{activeTab === 'components' && (
  <div ref={componentsRef} className="scroll-mt-32">
    {/* Existing components/BOM content from lines 1065-1194 */}
  </div>
)}
{activeTab === 'job-cards' && (
  <JobCardsTab orderId={orderId} />
)}
{activeTab === 'procurement' && (
  <ProcurementTab orderId={orderId} />
)}
{activeTab === 'documents' && (
  <OrderDocumentsTab orderId={orderId} />
)}
{activeTab === 'issue-stock' && (
  <IssueStockTab orderId={orderId} order={order} componentRequirements={componentRequirements} />
)}
```

The Products tab content (product list, stock reservations, BOM summary, pricing) currently lives inline in page.tsx (lines 851-1214). For now, keep it inline within the `activeTab === 'products'` block. Task 3 will extract it into a proper two-column layout.

### Step 5: Verify and commit

Run: `npx tsc --noEmit && npm run lint`
Visually verify: each tab click switches content, URL updates with `?tab=`, back button works.

```bash
git add -A && git commit -m "feat: convert order detail to real content-switching tabs

Replace scroll-anchor SmartButtonsRow with tab bar that switches
content. URL syncs via ?tab= param. Remove accordion/collapsible
infrastructure."
```

---

## Task 2: Light Mode Visual Hierarchy

**Goal:** Improve visual differentiation so sections don't blend together in light mode.

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`
- Modify: `components/features/orders/SmartButtonsRow.tsx` (if needed)
- Possibly: `app/globals.css` or layout wrapper

### Step 1: Add page background tint

In the page's main content wrapper, add `bg-muted/30` to the content area below the sticky header. This creates a subtle gray canvas so white cards float visually. In dark mode the muted color is already darker than cards, so this works in both themes.

### Step 2: Add shadow and left-border accents to section cards

For each major section card within tab content:
- Add `shadow-sm` alongside existing `border` classes
- For action-oriented sections (Stock Reservations, BOM/Components with Order Components button), add `border-l-3 border-primary/40` left accent

### Step 3: Increase section spacing

Change the gap between major sections from `gap-3`/`space-y-3` to `gap-5`/`space-y-5` within tab content areas.

### Step 4: Style the sticky header

The sticky header (line 807) currently has `border-b shadow-sm`. Verify it provides enough separation. If needed, increase to `shadow-md` or add `bg-muted/5` tint behind it.

### Step 5: Verify both themes and commit

Test in both light and dark mode using preview tools. Take screenshots of both.

```bash
git add -A && git commit -m "style: improve light mode visual hierarchy

Add page background tint, card shadows, left-border accents on
action sections, increased spacing between sections."
```

---

## Task 3: Products Tab — Two-Column Layout

**Goal:** When the Products tab is active, show a two-column layout with product info on the left and a sidebar with customer docs + order progress on the right.

**Files:**
- Create: `components/features/orders/OrderOverviewTab.tsx`
- Create: `components/features/orders/OrderSidebar.tsx`
- Modify: `app/orders/[orderId]/page.tsx` (extract Products tab content)

### Step 1: Create OrderSidebar component

Create `components/features/orders/OrderSidebar.tsx`:

Props:
```tsx
interface OrderSidebarProps {
  orderId: number;
  order: Order | null;
  componentRequirements: ProductRequirement[];
}
```

Content sections:
1. **Customer Order Documents** — query `order_attachments` where `category = 'Customer Order'` for this order. Show thumbnail previews using existing `PdfThumbnail` component. If none, show "No customer order attached" + a small dropzone.
2. **Order Progress** card:
   - Stock issuance: query `stock_issuances` count vs total BOM components → "3/5 issued" with a tiny progress bar
   - Job cards: query `job_cards` count by status → "2 active, 1 complete"
   - Procurement: query `purchase_order_lines` → "1 PO pending"
3. **Quick Actions** — two small outline buttons: "Issue Stock" and "Create Job Card" that call a passed-in `onTabChange` handler

### Step 2: Create OrderOverviewTab component

Create `components/features/orders/OrderOverviewTab.tsx`:

Props: all the data/handlers currently used by the inline Products section in page.tsx (product list, stock reservations, BOM, pricing).

Layout:
```tsx
<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
  {/* Left column */}
  <div className="space-y-5">
    {/* Products section — extracted from page.tsx lines 851-937 */}
    {/* Stock Reservations — extracted from page.tsx lines 939-1063 */}
    {/* BOM/Components summary — extracted from page.tsx lines 1065-1194 */}
    {/* Pricing — extracted from page.tsx lines 1196-1214 */}
  </div>
  {/* Right sidebar */}
  <OrderSidebar orderId={orderId} order={order} componentRequirements={componentRequirements} />
</div>
```

### Step 3: Wire into page.tsx

In `app/orders/[orderId]/page.tsx`, replace the inline Products tab content block with:
```tsx
{activeTab === 'products' && (
  <OrderOverviewTab
    orderId={orderId}
    order={order}
    /* pass all needed props */
    onTabChange={handleTabChange}
  />
)}
```

This extracts ~350 lines of inline JSX from page.tsx into a dedicated component.

### Step 4: Verify responsive behavior and commit

Test at desktop (two columns) and mobile/tablet (single column with sidebar below). Verify customer doc thumbnails render.

```bash
git add -A && git commit -m "feat: two-column Products overview with sidebar

Extract Products tab content into OrderOverviewTab with customer
doc thumbnails, order progress indicators, and quick actions in
a right sidebar. Responsive: stacks on mobile."
```

---

## Task 4: Orders List — Issuance Status Column

**Goal:** Add an "Issued" column to the orders list showing stock issuance progress per order.

**Files:**
- Modify: `app/orders/page.tsx`

### Step 1: Add the issuance summary query

In the data-fetching section of `app/orders/page.tsx`, add a query that fetches issuance progress for all orders currently visible. Use a Supabase RPC or a client-side join:

Option A (preferred — single query via `execute_sql` or view):
```sql
SELECT
  od.order_id,
  COUNT(DISTINCT pc.component_id) AS total_components,
  COUNT(DISTINCT si.component_id) AS issued_components
FROM order_details od
JOIN product_components pc ON pc.product_id = od.product_id
LEFT JOIN stock_issuances si ON si.order_id = od.order_id AND si.component_id = pc.component_id
GROUP BY od.order_id
```

Option B (client-side — simpler, use if view isn't practical):
- Fetch `stock_issuances` grouped by `order_id` with count
- Fetch `order_details` → `product_components` count per order
- Merge client-side

Use React Query with a key like `['issuance-summary']`.

### Step 2: Add the "Issued" column to the table

In the table header section (~line 2250), add a new `<TableHead>` after "Items":
```tsx
<TableHead className="w-20">Issued</TableHead>
```

In the table body (~line 2267), add the cell after the Items cell:
```tsx
<TableCell className="w-20">
  <IssuedBadge issued={summary?.issued ?? 0} total={summary?.total ?? 0} />
</TableCell>
```

### Step 3: Create the IssuedBadge inline component

```tsx
function IssuedBadge({ issued, total }: { issued: number; total: number }) {
  if (total === 0) return <span className="text-muted-foreground text-sm">—</span>;
  const color = issued >= total
    ? 'text-green-600'
    : issued > 0
    ? 'text-amber-600'
    : 'text-muted-foreground';
  return <span className={cn('text-sm font-medium', color)}>{issued}/{total}</span>;
}
```

### Step 4: Verify and commit

Check the orders list page renders the new column with correct data. Verify colors: green for fully issued, amber for partial, gray for none.

```bash
git add -A && git commit -m "feat: add issuance status column to orders list

Show issued/total fraction with color coding (green=complete,
amber=partial, gray=none) for each order."
```

---

## Task 5: Issue Stock Tab Optimizations

**Goal:** Optimize the Issue Stock tab for speed — auto-select products, prominent action button, compact layout.

**Files:**
- Modify: `components/features/orders/IssueStockTab.tsx`

### Step 1: Auto-select all products on mount

In `IssueStockTab.tsx`, the `selectedOrderDetails` state starts empty (line 125). Add a `useEffect` that auto-selects all order details when the component mounts and products exist:

```tsx
useEffect(() => {
  if (orderDetails && orderDetails.length > 0 && selectedOrderDetails.size === 0) {
    setSelectedOrderDetails(new Set(orderDetails.map(d => d.id)));
  }
}, [orderDetails]);
```

This pre-selects all products so the components table immediately shows what needs issuing.

### Step 2: Move Issue Stock button to top-right

Currently the Issue Stock button is at line 874, buried below the components table. Move it to a header row at the top of the tab content:

```tsx
<div className="flex items-center justify-between mb-4">
  <h3 className="text-lg font-semibold">Issue Stock</h3>
  <Button
    size="lg"
    className="gap-2"
    onClick={handleIssueStock}
    disabled={selectedComponents.length === 0 || issueMutation.isPending}
  >
    {issueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
    Issue Stock
  </Button>
</div>
```

### Step 3: Compact the metadata fields

The Issue To, PO ID, and Notes fields (around lines 800-870) are currently stacked or take significant vertical space. Restructure them into a single horizontal row:

```tsx
<div className="grid grid-cols-3 gap-3">
  <div>
    <Label className="text-xs text-muted-foreground">Issue To (Optional)</Label>
    <Select ...>{/* existing */}</Select>
  </div>
  <div>
    <Label className="text-xs text-muted-foreground">PO ID (Optional)</Label>
    <Input ...>{/* existing */}</Input>
  </div>
  <div>
    <Label className="text-xs text-muted-foreground">Notes (Optional)</Label>
    <Input ...>{/* existing, change from Textarea to Input for compactness */}</Input>
  </div>
</div>
```

### Step 4: Ensure Issuance History is visible without extra clicks

Verify the Issuance History section (lines 896-1058) renders directly below the issue form without needing to expand an accordion. It should already be visible since it's in the same component, but confirm there's no collapse wrapper around it.

### Step 5: Verify and commit

Test the Issue Stock tab: products should be pre-selected, components table shows immediately, Issue button is prominent at top, metadata fields are compact, history is visible below.

```bash
git add -A && git commit -m "feat: optimize Issue Stock tab for speed

Auto-select all products, move Issue button to prominent top-right
position, compact metadata fields into single row."
```

---

## Task 6: Final Verification and Cleanup

**Goal:** Full verification pass across both pages and both themes.

**Files:**
- All modified files

### Step 1: Type check and lint

```bash
npx tsc --noEmit
npm run lint
```

Fix any errors.

### Step 2: Visual verification — Order Detail

Using preview tools, verify each tab:
- Products/Overview: two-column layout, sidebar with customer docs, order progress
- Components: renders correctly
- Job Cards: renders correctly
- Procurement: renders correctly
- Documents: renders correctly
- Issue Stock: auto-select, prominent button, compact fields, history visible

### Step 3: Visual verification — Orders List

Verify the Issued column shows correct data with proper color coding.

### Step 4: Light mode verification

Switch to light mode and verify:
- Page background tint provides card separation
- Shadows visible on section cards
- Left-border accents on action sections
- Tab bar readable with clear active indicator

### Step 5: Dark mode verification

Switch to dark mode and verify nothing regressed.

### Step 6: URL deep linking

Test `?tab=issue-stock` loads directly to Issue Stock tab. Test back button navigation between tabs.

### Step 7: Run security advisors

```bash
# Check for missing RLS if any migrations were added
```
Use `mcp__supabase__get_advisors` (security).

### Step 8: Final commit if any cleanup needed

```bash
git add -A && git commit -m "chore: final verification and cleanup for orders UX overhaul"
```

---

## Summary

| Task | Priority | Estimate | Description |
|------|----------|----------|-------------|
| 1 | Highest | 30 min | Convert to real content-switching tabs |
| 2 | High | 15 min | Light mode visual hierarchy |
| 3 | Medium | 45 min | Two-column Products overview + sidebar |
| 4 | Medium | 30 min | Issuance status on orders list |
| 5 | Lower | 20 min | Issue Stock tab optimizations |
| 6 | Required | 15 min | Final verification |

**Total estimated time: ~2.5 hours**

**Batch candidate note:** Task 2 (visual hierarchy) touches many sections but the pattern is consistent (add shadow-sm, border-l accents, increase gaps). This qualifies as a `/batch` operation per CLAUDE.md rules — but since it's one task in the plan and the changes are straightforward, it can be done in a single pass.
