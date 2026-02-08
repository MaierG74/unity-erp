# Purchasing Dashboard Redesign

## Design Specification v1.1

---

## 1. Executive Summary

The current purchasing dashboard surfaces three metric cards (Pending, Approved, Partially Delivered) and a list of recent orders. The redesign transforms this into an **action-oriented command center** that serves three equal workflows:

1. **Order Creation** -- Fast access to create and manage new purchase orders
2. **Goods Receipt** -- High-volume receiving (4-10 deliveries/day, currently 5-6 clicks each = 50-60 wasted clicks daily)
3. **Order Follow-up & Tracking** -- Monitoring open orders, overdue deliveries, pending approvals

The dashboard must give **equal weight to all three workflows**, not favor one over the others. Every workflow should be achievable with minimal navigation from this single page.

Key changes:
- **5 status cards** replacing 3, with color-coded urgency signals
- **"Awaiting Receipt" widget** -- a flat list of unreceived line items with inline Receive buttons (the single highest-impact change, saving ~50 clicks/day)
- **"Needs Attention" feed** replacing the static recent orders list (order tracking/follow-up)
- **Quick action bar** for order creation, receiving, and follow-up actions
- **Dashboard search bar** for PO numbers, suppliers, and components
- **Inline actions** on the All Orders table (Receive, Email, View)
- **Sidebar sub-navigation** for Purchasing with sub-items
- **`expected_delivery_date`** column on `purchase_orders` for overdue tracking (nullable -- existing orders won't have it)
- **Quick "Receive Stock"** action surfaced on the main app dashboard

---

## 2. Database Changes

### 2.1 New Column: `expected_delivery_date`

**Migration name:** `add_expected_delivery_date_to_purchase_orders`

```sql
ALTER TABLE purchase_orders
ADD COLUMN expected_delivery_date date;

COMMENT ON COLUMN purchase_orders.expected_delivery_date
  IS 'Expected delivery date set when order is approved. Used for overdue calculations and delivery calendar widgets.';
```

**Impact:**
- The order detail page (`app/purchasing/purchase-orders/[id]/page.tsx`) needs a date picker field for this when editing/creating orders
- The new dashboard widgets query against this field for "Overdue" and "This Week" calculations
- No default value -- existing orders will show as "No ETA" in the UI

---

## 3. Layout Overview

The redesigned dashboard uses a **two-column layout on desktop** (main content area + right sidebar feed) collapsing to **single column on mobile**. The layout is organized to give equal prominence to the three core workflows.

```
+---------------------------------------------------------------+
|  PageToolbar: "Purchasing" + Search bar + [New Order] button   |
+---------------------------------------------------------------+
|                                                                |
|  Quick Actions Bar:                                            |
|  [+ New Order]  [Receive Stock]  [All Orders]                 |
|                                                                |
+---------------------------------------------------------------+
|                                                                |
|  [Card 1]  [Card 2]  [Card 3]  [Card 4]  [Card 5]           |
|  Awaiting  Overdue   Partial   Pending    This Week           |
|  Delivery  (red)     Received  Approval   Deliveries          |
|  (primary) (destr.)  (warning) (muted)    (info)              |
|                                                                |
+---------------------------------------+-----------------------+
|                                       |                       |
|  Awaiting Receipt Widget              |  Needs Attention      |
|  (Table: component, supplier,         |  Feed                 |
|   qty ordered, qty owing, [Receive])  |  (Exception items     |
|                                       |   with action links)  |
|  WORKFLOW: Goods Receipt              |  WORKFLOW: Follow-up   |
|  (saves ~50 clicks/day)              |  & Tracking            |
|                                       |                       |
+---------------------------------------+-----------------------+
```

**Workflow mapping to layout areas:**
- **Order Creation**: Quick Actions bar (New Order button, always visible) + PageToolbar action
- **Goods Receipt**: Awaiting Receipt widget (main area, 2/3 width) + Receive buttons on metric cards
- **Follow-up & Tracking**: Needs Attention feed (sidebar, 1/3 width) + Status metric cards + search

**Responsive breakpoints:**
- `lg` (1024px+): Two-column layout (2/3 + 1/3)
- `md` (768px-1023px): Single column, all sections stacked
- `sm` (<768px): Single column, cards scroll horizontally

---

## 4. Component Specifications

### 4.1 Page Header with Search

**Component:** Reuse existing `PageToolbar` from `components/ui/page-toolbar.tsx`

**Visual layout:**
- Title: "Purchasing" (left)
- Search bar: center, placeholder "Search PO numbers, suppliers, components..." (md:w-80)
- Actions: [+ New Order] primary button (right)

**Data requirements:**
- Search is client-side against the already-fetched orders data
- Searches across: `q_number`, supplier names (from joined `suppliers.name`), component descriptions (from joined `suppliercomponents > components.description`)

**Interaction:**
- Typing in search filters the Awaiting Receipt table and Needs Attention feed simultaneously
- Search debounced at 300ms (reuse existing `useDebounce` hook)
- Clear button (X) appears when search has content

**Implementation:**
```tsx
<PageToolbar
  title="Purchasing"
  searchPlaceholder="Search PO numbers, suppliers, components..."
  searchValue={searchQuery}
  onSearchChange={setSearchQuery}
  actions={[
    { label: 'New Order', onClick: () => router.push('/purchasing/purchase-orders/new'), icon: <PlusCircle className="h-4 w-4" /> }
  ]}
/>
```

---

### 4.2 Quick Actions Bar

**Component:** Inline in `app/purchasing/page.tsx` (no separate component needed -- it's just 3 buttons in a flex row)

**Purpose:** Gives equal, persistent access to all three core workflows from the top of the page. Unlike the PageToolbar actions which are right-aligned and secondary, these are prominent, centered action buttons.

**Visual layout:**
```
flex gap-3 items-center justify-start
```

Three buttons, each using the existing `Button` component:

| Button | Variant | Icon | Href | Workflow |
|--------|---------|------|------|----------|
| New Order | `default` (primary fill) | `PlusCircle` | `/purchasing/purchase-orders/new` | Order Creation |
| Receive Stock | `outline` with `text-warning border-warning hover:bg-warning/10` | `Download` | Scrolls to Awaiting Receipt widget | Goods Receipt |
| All Orders | `outline` | `ClipboardList` | `/purchasing/purchase-orders` | Follow-up/Tracking |

**Interaction:**
- "New Order" navigates to the new order form
- "Receive Stock" smooth-scrolls to the Awaiting Receipt widget and applies a brief `ring-2 ring-primary` highlight (1.5s fade)
- "All Orders" navigates to the full orders list page

**Responsive:**
- `md+`: Buttons in a horizontal row
- `sm`: Buttons stack into a 3-column grid (`grid grid-cols-3 gap-2`) with smaller text

**Why not just use the PageToolbar actions?** The PageToolbar "New Order" button stays, but it's small and right-aligned. The Quick Actions bar gives equal visual weight to all three workflows, making it clear the dashboard serves creating, receiving, AND tracking. The user reported all three are part of their daily routine, so none should feel hidden.

---

### 4.3 Status Metric Cards

**Component:** `PurchasingMetricCards` (new)
**File:** `components/features/purchasing/PurchasingMetricCards.tsx`

**Layout:** 5 cards in a responsive grid
```
grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5
```

Each card uses the existing `Card`, `CardHeader`, `CardContent` from `components/ui/card.tsx`.

#### Card 1: Awaiting Delivery
- **Icon:** `Truck` (lucide) -- `text-primary`
- **Count:** Orders with status "Approved" that have zero received quantity and no overdue flag
- **Subtitle:** "Approved, not yet received"
- **Border accent:** `border-l-4 border-l-primary` (teal)
- **Click action:** Filters Awaiting Receipt widget to show only these orders
- **Active state:** `bg-primary/5 border-primary` ring

#### Card 2: Overdue
- **Icon:** `AlertTriangle` (lucide) -- `text-destructive`
- **Count:** Orders where `expected_delivery_date < today` AND status is "Approved" or "Partially Received" AND not fully received
- **Subtitle:** "Past expected delivery"
- **Border accent:** `border-l-4 border-l-destructive` (red)
- **Visual emphasis:** When count > 0, the card gets `bg-destructive/5` background and a subtle pulsing dot indicator next to the count
- **Nullable handling:** Orders without `expected_delivery_date` are NOT counted as overdue (they have no ETA to be late against). Only orders with an explicit date in the past qualify.
- **Click action:** Filters to overdue orders only

#### Card 3: Partially Received
- **Icon:** `PackageCheck` (lucide) -- `text-warning`
- **Count:** Orders where some line items received but not all (reuses existing `isPartiallyDelivered` logic)
- **Subtitle:** "Outstanding items remaining"
- **Border accent:** `border-l-4 border-l-warning` (amber)
- **Click action:** Filters to partially received orders

#### Card 4: Pending Approval
- **Icon:** `Clock` (lucide) -- `text-muted-foreground`
- **Count:** Orders with status "Draft" or "Pending Approval"
- **Subtitle:** "Awaiting review"
- **Border accent:** `border-l-4 border-l-muted-foreground`
- **Click action:** Filters to pending orders

#### Card 5: This Week's Deliveries
- **Icon:** `Calendar` (lucide) -- `text-info`
- **Count:** Orders where `expected_delivery_date` falls within current Mon-Fri week AND not fully received
- **Subtitle:** "Expected this week"
- **Border accent:** `border-l-4 border-l-info` (blue)
- **Nullable handling:** Orders without `expected_delivery_date` are excluded from this count. When many orders lack dates, show a subtle helper text below the count: "{N} orders have no ETA" as a nudge to populate the field.
- **Click action:** Filters to this week's deliveries

**Data query:** Single TanStack Query fetching all non-completed orders with their line item totals:
```
queryKey: ['purchasing-dashboard-metrics']
```

**Loading state:** Each card shows a `Skeleton` pulse animation (`h-8 w-16`) for the count, with the icon and subtitle visible immediately.

**Empty state:** Cards always render. Count shows "0" with normal styling (no special empty treatment -- zero is valid information).

---

### 4.4 Awaiting Receipt Widget (Primary Widget)

**Component:** `AwaitingReceiptWidget`
**File:** `components/features/purchasing/AwaitingReceiptWidget.tsx`

This is the **highest-priority change**. It surfaces individual line items (not whole orders) that have outstanding quantities, with an inline Receive button.

**Visual layout:**
```
+-------------------------------------------------------------------+
|  Card Header: "Awaiting Receipt"               [View All Orders]  |
|  Subtitle: "12 items across 5 orders"                             |
+-------------------------------------------------------------------+
|  Table:                                                           |
|  Component       | Supplier    | PO      | Ordered | Owing | Act |
|  -----------------------------------------------------------|-----|
|  ALU-SHEET-2MM   | MetalCo     | Q1234   |   100   |  40   | [R] |
|  SS-TUBE-25MM    | SteelWorks  | Q1235   |    50   |  50   | [R] |
|  BRASS-ROD-10MM  | MetalCo     | Q1234   |   200   | 200   | [R] |
|  ...             |             |         |         |       |     |
+-------------------------------------------------------------------+
|  Showing 10 of 42 items          [Load More]                      |
+-------------------------------------------------------------------+
```

**Table columns:**

| Column | Width | Content |
|--------|-------|---------|
| Component | flex-1 (min-w-[180px]) | `components.internal_code` bold + `components.description` muted below |
| Supplier | w-[140px] | `suppliers.name` as Badge variant="outline" |
| PO | w-[80px] | `purchase_orders.q_number` as clickable link (navigates to order detail) |
| Ordered | w-[80px] text-right | `supplier_orders.order_quantity` |
| Owing | w-[80px] text-right | `order_quantity - total_received`, styled `text-destructive font-semibold` when > 0 |
| Actions | w-[100px] text-right | Receive button |

**Receive button:**
- Small button: `<Button size="sm" variant="default">Receive</Button>`
- Icon: `<Download className="h-3.5 w-3.5 mr-1" />`
- On click: Opens the existing `ReceiveItemsModal` (from `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx`) in a Dialog, pre-populated with the line item data
- This is the key UX improvement: **1 click to start receiving** vs the current 4-5 clicks

**Data query:**
```sql
SELECT
  so.order_id,
  so.order_quantity,
  so.total_received,
  so.purchase_order_id,
  po.q_number,
  po.expected_delivery_date,
  sc.price,
  c.component_id,
  c.internal_code,
  c.description as component_description,
  s.supplier_id,
  s.name as supplier_name
FROM supplier_orders so
JOIN purchase_orders po ON so.purchase_order_id = po.purchase_order_id
JOIN suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
JOIN components c ON sc.component_id = c.component_id
JOIN suppliers s ON sc.supplier_id = s.supplier_id
WHERE po.status_id IN (7, 8)  -- Approved, Partially Received
  AND (so.total_received IS NULL OR so.total_received < so.order_quantity)
ORDER BY po.expected_delivery_date ASC NULLS LAST, po.created_at DESC;
```

TanStack Query key: `['awaiting-receipt-items']`

**Pagination:** Client-side, 10 items per page with "Load More" button that expands by 10.

**Loading state:** 5 skeleton rows with pulse animation matching the table column widths.

**Empty state:**
```
Card with centered content:
  [CheckCircle2 icon in text-success, h-12 w-12]
  "All caught up!"
  "No items are currently awaiting receipt."
  [View All Orders] button (outline variant)
```

**Sorting:**
- Default: Overdue items first (expected_delivery_date < today), then by expected_delivery_date ASC, then by created_at DESC
- Orders without `expected_delivery_date` sort after dated orders but before non-urgent items. They show "No ETA" in muted text where the date would appear.
- Overdue rows get a subtle `bg-destructive/5` background tint and a small `Badge variant="destructive"` showing "Overdue" next to the PO number

**Row hover:** `hover:bg-muted/50` transition

**Filter interaction with cards:** When a metric card is clicked (active), the widget filters to show only matching items. A `Badge` appears next to the widget title showing the active filter (e.g., "Overdue only") with an X to clear.

---

### 4.5 Needs Attention Feed

**Component:** `NeedsAttentionFeed`
**File:** `components/features/purchasing/NeedsAttentionFeed.tsx`

Replaces the current "Recent Purchase Orders" list with an **exception-based feed** of items that need human action.

**Visual layout:**
```
+------------------------------------------+
|  Card Header: "Needs Attention"     (3)  |
+------------------------------------------+
|                                          |
|  [!] Overdue: Q1234 from MetalCo        |
|      Expected Feb 1 - 5 days late        |
|      [View Order]                        |
|                                          |
|  [Clock] Pending Approval: Q1240        |
|      Created Jan 30 - 7 days waiting     |
|      [Review]                            |
|                                          |
|  [Truck] Due Tomorrow: Q1238            |
|      SteelWorks - 3 items                |
|      [View Order]                        |
|                                          |
|  [Package] Partial: Q1235               |
|      2 of 5 items received               |
|      [Continue Receiving]                |
|                                          |
+------------------------------------------+
```

**Feed item types (priority order):**

1. **Overdue deliveries** (highest priority)
   - Icon: `AlertTriangle` in `text-destructive`
   - Title: "Overdue: {q_number} from {supplier}"
   - Subtitle: "Expected {date} - {N} days late"
   - Action: "View Order" link

2. **Pending approval > 3 days**
   - Icon: `Clock` in `text-warning`
   - Title: "Pending Approval: {q_number}"
   - Subtitle: "Created {date} - {N} days waiting"
   - Action: "Review" link

3. **Due today/tomorrow**
   - Icon: `Truck` in `text-info`
   - Title: "Due {Today/Tomorrow}: {q_number}"
   - Subtitle: "{supplier} - {N} items"
   - Action: "View Order" link

4. **Partially received with outstanding items**
   - Icon: `PackageCheck` in `text-warning`
   - Title: "Partial Receipt: {q_number}"
   - Subtitle: "{received} of {total} items received"
   - Action: "Continue Receiving" link

**Data requirements:** Reuses the same query as the metric cards. Feed items are computed client-side from the dashboard data.

**Layout for each feed item:**
```tsx
<div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
  <div className="mt-0.5 rounded-full bg-{color}/10 p-1.5">
    <Icon className="h-4 w-4 text-{color}" />
  </div>
  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium truncate">{title}</p>
    <p className="text-xs text-muted-foreground">{subtitle}</p>
  </div>
  <Button variant="ghost" size="sm" asChild>
    <Link href={orderUrl}>{actionLabel}</Link>
  </Button>
</div>
```

**Loading state:** 4 skeleton items with icon circle + two text lines.

**Empty state:**
```
Centered:
  [CheckCircle2 in text-success]
  "Nothing needs attention"
  "All orders are on track."
```

**Max items:** Show 8 items maximum. If more exist, show "View {N} more items" link that navigates to `/purchasing/purchase-orders?tab=inProgress`.

**Count badge:** The card header shows a count badge `(N)` in `Badge variant="destructive"` when there are attention items, or `Badge variant="secondary"` showing "0" when empty.

---

### 4.6 Two-Column Layout Container

**Implementation in `app/purchasing/page.tsx`:**

```tsx
{/* Status Cards */}
<PurchasingMetricCards
  activeFilter={activeFilter}
  onFilterChange={setActiveFilter}
  metrics={metrics}
  isLoading={metricsLoading}
/>

{/* Quick Actions Bar - equal access to all 3 workflows */}
<div className="flex gap-3 items-center">
  <Button asChild>
    <Link href="/purchasing/purchase-orders/new">
      <PlusCircle className="h-4 w-4 mr-2" />
      New Order
    </Link>
  </Button>
  <Button variant="outline" className="text-warning border-warning hover:bg-warning/10"
    onClick={() => scrollToReceiptWidget()}>
    <Download className="h-4 w-4 mr-2" />
    Receive Stock
  </Button>
  <Button variant="outline" asChild>
    <Link href="/purchasing/purchase-orders">
      <ClipboardList className="h-4 w-4 mr-2" />
      All Orders
    </Link>
  </Button>
</div>

{/* Status Cards */}
<PurchasingMetricCards
  activeFilter={activeFilter}
  onFilterChange={setActiveFilter}
  metrics={metrics}
  isLoading={metricsLoading}
/>

{/* Two-column content area */}
<div className="grid gap-6 lg:grid-cols-3">
  {/* Main content: 2/3 width -- GOODS RECEIPT workflow */}
  <div className="lg:col-span-2" ref={receiptWidgetRef}>
    <AwaitingReceiptWidget
      activeFilter={activeFilter}
      searchQuery={debouncedSearch}
    />
  </div>

  {/* Sidebar: 1/3 width -- FOLLOW-UP & TRACKING workflow */}
  <div className="lg:col-span-1">
    <NeedsAttentionFeed searchQuery={debouncedSearch} />
  </div>
</div>
```

---

## 5. Sidebar Sub-Navigation

### 5.1 Current Structure

The sidebar (`components/layout/sidebar.tsx`) uses a flat `navigation` array. Each item has `name`, `href`, `icon`. There is no sub-item support.

### 5.2 Proposed Change

Add a `children` array to navigation items that need sub-navigation:

```typescript
interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  children?: { name: string; href: string }[];
}
```

**Purchasing sub-items:**
```typescript
{
  name: 'Purchasing',
  href: '/purchasing',
  icon: ShoppingBag,
  children: [
    { name: 'Dashboard', href: '/purchasing' },
    { name: 'All Orders', href: '/purchasing/purchase-orders' },
    { name: 'New Order', href: '/purchasing/purchase-orders/new' },
  ]
}
```

**Collapsed sidebar behavior:** Sub-items appear in the tooltip flyout on hover (using the existing `TooltipContent` pattern but with a list of links).

**Expanded sidebar behavior:**
- Parent item is always visible and clickable (navigates to dashboard)
- Clicking the parent also toggles the sub-items open/closed (chevron indicator)
- Sub-items indent 12px from parent, with a subtle left border line (`border-l-2 border-border/50 ml-6 pl-3`)
- Sub-items use `text-sm` vs parent's default size
- Active sub-item gets `text-primary font-medium` styling
- Sub-items auto-expand when the current path matches any child href

**Animation:** Sub-items slide down with `transition-all duration-200` using `max-height` technique or `framer-motion`'s `AnimatePresence`.

---

## 6. All Orders Table -- Inline Actions

### 6.1 Current State

The All Orders page (`app/purchasing/purchase-orders/page.tsx`) has a "View Details" link and a Delete button (draft only) in the Actions column.

### 6.2 Proposed Enhancements

Replace the single "View Details" button with a row of icon buttons that appear on hover:

```
Actions column (w-[140px], text-right):

Default (visible):
  [View] ghost button with ExternalLink icon

On hover (row gets hover:bg-muted/50):
  [Receive] [Email] [View]
  - Receive: Download icon, primary variant, only shows for status Approved/Partially Received
  - Email: Mail icon, ghost variant, only shows for orders with a supplier
  - View: ExternalLink icon, ghost variant, always visible
```

**Implementation:**
```tsx
<div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
  {canReceive && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8"
          onClick={(e) => { e.stopPropagation(); openReceiveModal(order); }}>
          <Download className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Receive Items</TooltipContent>
    </Tooltip>
  )}
  {hasSupplier && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8"
          onClick={(e) => { e.stopPropagation(); emailSupplier(order); }}>
          <Mail className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Email Supplier</TooltipContent>
    </Tooltip>
  )}
  <Tooltip>
    <TooltipTrigger asChild>
      <Button size="icon" variant="ghost" className="h-8 w-8" asChild>
        <Link href={`/purchasing/purchase-orders/${order.purchase_order_id}`}>
          <ExternalLink className="h-4 w-4" />
        </Link>
      </Button>
    </TooltipTrigger>
    <TooltipContent>View Details</TooltipContent>
  </Tooltip>
</div>
```

The `<TableRow>` gets `className="group"` to support `group-hover:opacity-100`.

**Mobile:** On touch devices, all action buttons are always visible (no hover). Add `md:opacity-0 md:group-hover:opacity-100` to handle this.

---

## 7. Quick "Receive Stock" on Main Dashboard

### 7.1 Change to App Dashboard

In `app/dashboard/page.tsx`, add a fourth quick action:

```typescript
const quickActions = [
  { label: 'New Order', icon: FileText, href: '/orders/new', color: 'bg-primary' },
  { label: 'New Product', icon: Box, href: '/products/new', color: 'bg-info' },
  { label: 'Add Customer', icon: UsersIcon, href: '/customers/new', color: 'bg-success' },
  { label: 'Receive Stock', icon: Download, href: '/purchasing?action=receive', color: 'bg-warning' },
];
```

When the purchasing dashboard loads with `?action=receive` in the URL, it auto-scrolls to the Awaiting Receipt widget and briefly highlights it with a `ring-2 ring-primary` animation that fades out after 1.5s.

---

## 8. Color System Reference

All colors use the existing CSS custom properties defined in `app/globals.css`:

| Semantic Use | CSS Variable | Light Mode | Dark Mode | Badge Variant |
|---|---|---|---|---|
| Primary / Awaiting | `--primary` | Teal | Teal | `default` |
| Danger / Overdue | `--destructive` | Red | Dark Red | `destructive` |
| Warning / Partial | `--warning` | Amber | Amber | `warning` |
| Info / This Week | `--info` | Blue | Blue | N/A (custom) |
| Success / Complete | `--success` | Green | Green | `success` |
| Neutral / Pending | `--muted-foreground` | Gray | Gray | `secondary` |

---

## 9. Data Architecture

### 9.1 Query Strategy

The dashboard uses **3 TanStack queries** total:

1. **`['purchasing-dashboard-metrics']`** -- Fetches all non-completed purchase orders with their supplier_orders aggregates. Powers both the metric cards AND the Needs Attention feed (computed client-side from same data).

2. **`['awaiting-receipt-items']`** -- Fetches individual `supplier_orders` line items that have outstanding quantities, joined with component and supplier details. Powers the Awaiting Receipt widget.

3. **`['purchasing-dashboard-search', debouncedSearch]`** -- Only active when search query is non-empty. Searches across PO numbers, supplier names, and component codes. Could reuse query 2's data with client-side filtering for simplicity.

### 9.2 Cache Invalidation

All three queries should be invalidated when:
- A receive action is completed (via `queryClient.invalidateQueries({ queryKey: ['purchasing-dashboard'] })` using a prefix match)
- An order status changes
- A new order is created

Use a shared prefix: all query keys start with `'purchasing-dashboard'` for easy batch invalidation.

Revised keys:
```typescript
['purchasing-dashboard', 'metrics']
['purchasing-dashboard', 'awaiting-receipt']
['purchasing-dashboard', 'search', debouncedSearch]
```

### 9.3 Stale Time

Set `staleTime: 30_000` (30 seconds) for the metrics and awaiting-receipt queries. This prevents refetching on every tab switch while keeping data reasonably fresh.

---

## 10. Receive Modal Integration

### 10.1 Current Flow (4-5 clicks)

1. Dashboard -> Click order in list
2. Order detail page loads
3. Scroll to line items table
4. Click "Receive" on specific line item
5. ReceiveItemsModal opens

### 10.2 New Flow (1 click)

1. Dashboard -> Click "Receive" button on any line item in the Awaiting Receipt widget
2. ReceiveItemsModal opens, pre-populated

### 10.3 Implementation

The `ReceiveItemsModal` currently lives at `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx` and expects specific props tied to the order detail page context. To use it from the dashboard:

**Option A (Recommended):** Extract the modal to a shared location:
- Move to `components/features/purchasing/ReceiveItemsModal.tsx`
- Accept props: `orderId`, `orderItem` (the supplier_order with component info), `onSuccess` callback
- Import from both the order detail page and the dashboard widget

**Option B (Quick):** Keep modal in place, but when clicking Receive on the dashboard, navigate to `purchasing/purchase-orders/{id}?receive={order_id}` which auto-opens the modal on the detail page. Less ideal but faster to implement.

---

## 11. Responsive Design Details

### 11.1 Metric Cards
- **lg+**: 5 cards in a row (`grid-cols-5`)
- **md**: 3 cards first row, 2 cards second row (`grid-cols-3`)
- **sm**: 2 cards per row (`grid-cols-2`), last card spans full width
- **xs**: Horizontal scroll container with snap points (`flex overflow-x-auto snap-x snap-mandatory`)

### 11.2 Awaiting Receipt Table
- **lg+**: Full table with all columns
- **md**: Hide "Ordered" column, show only "Owing"
- **sm**: Switch from table to card layout:
  ```
  +----------------------------------+
  | ALU-SHEET-2MM          [Receive] |
  | MetalCo | Q1234 | Owing: 40     |
  +----------------------------------+
  ```

### 11.3 Needs Attention Feed
- **lg+**: Right sidebar column (1/3 width)
- **md/sm**: Full width below the Awaiting Receipt widget

---

## 12. Accessibility

- All interactive cards have `role="button"` and `tabIndex={0}` with `onKeyDown` handling Enter/Space
- Status cards announce their count via `aria-label` (e.g., "5 orders awaiting delivery")
- Table uses proper `<thead>`, `<th scope="col">` markup (already handled by shadcn Table)
- Receive buttons have `aria-label="Receive items for {component_code}"`
- Focus ring visible on all interactive elements using existing `focus-visible:ring-2 focus-visible:ring-primary` pattern
- Color is never the sole indicator -- all status information has text labels alongside color

---

## 13. File Structure Summary

```
components/features/purchasing/
  PurchasingMetricCards.tsx      (NEW - 5 status cards)
  AwaitingReceiptWidget.tsx      (NEW - line-item receipt table)
  NeedsAttentionFeed.tsx         (NEW - exception feed)
  ReceiveItemsModal.tsx          (MOVED from app/purchasing/purchase-orders/[id]/)

app/purchasing/
  page.tsx                       (REWRITTEN - new dashboard layout)

app/purchasing/purchase-orders/
  page.tsx                       (MODIFIED - inline actions column)
  [id]/page.tsx                  (MODIFIED - import modal from shared location)

components/layout/
  sidebar.tsx                    (MODIFIED - add children/sub-nav support)

app/dashboard/
  page.tsx                       (MODIFIED - add "Receive Stock" quick action)
```

---

## 14. Implementation Priority

| Priority | Component | Effort | Impact |
|----------|-----------|--------|--------|
| P0 | Database migration (`expected_delivery_date`) | Small | Enables overdue tracking |
| P0 | `AwaitingReceiptWidget` | Medium | Highest UX impact -- 1-click receiving |
| P1 | `PurchasingMetricCards` (5 cards) | Small | Better at-a-glance status |
| P1 | `NeedsAttentionFeed` | Medium | Surfaces exceptions proactively |
| P2 | Sidebar sub-navigation | Medium | Better wayfinding |
| P2 | All Orders inline actions | Small | Faster actions from list view |
| P3 | Dashboard "Receive Stock" action | Small | Cross-module shortcut |
| P3 | Dashboard search | Small | Convenience feature |

---

## 15. Dark Theme Considerations

- Card backgrounds: `bg-card` (adapts automatically via CSS variables)
- Left border accents on cards use opacity-safe colors that work in both themes
- Table row hover: `hover:bg-muted/50` (works in both themes)
- Overdue row tint: `bg-destructive/5` (subtle in both themes, 5% opacity)
- Badge variants already support dark theme via the existing `badgeVariants` CVA config
- The pulsing dot on the Overdue card uses `bg-destructive` with `animate-pulse` -- visible in both themes
- Feed item icon backgrounds use `bg-{color}/10` which provides just enough contrast in dark mode without being garish

---

## 16. Animation and Micro-Interactions

- **Card hover:** `transition-all duration-200 hover:shadow-md hover:border-primary/50` (subtle lift effect)
- **Card active state:** `ring-2 ring-primary/30 bg-primary/5` with smooth transition
- **Receive button:** On successful receive, the row briefly flashes `bg-success/10` before being removed from the list with a `transition-opacity duration-300 opacity-0` then removal
- **Needs Attention feed:** New items slide in from top with `framer-motion` `AnimatePresence` (consistent with existing dashboard usage of framer-motion)
- **Metric card counts:** Number transition using CSS `transition: transform 0.2s` on count change (subtle scale bump)
- **Auto-scroll highlight** (from main dashboard "Receive Stock" action): `ring-2 ring-primary animate-pulse` that fades to transparent over 1.5s

---

*End of Design Specification*
