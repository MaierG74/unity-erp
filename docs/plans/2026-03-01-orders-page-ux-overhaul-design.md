# Orders Page UX Overhaul — Design

**Date:** 2026-03-01
**Status:** Approved
**Approach:** A — In-Place Tab Conversion (client-side tabs, no routing changes)

## Background

The order detail page (`/orders/[id]`) currently uses a single-scroll layout with smart buttons that scroll-anchor to collapsible accordion sections. This creates several problems:

1. **Issue Stock is buried** — a high-frequency, all-day task is hidden below the fold behind accordions
2. **Too much content on one page** — 7+ workflow areas stacked vertically
3. **Light mode readability is poor** — insufficient visual differentiation between sections
4. **Tab strip doesn't behave like tabs** — it scrolls instead of switching content

Research into Shopify, Katana MRP, NetSuite, Cin7, and Odoo confirms: real tabs switching content (not scrolling) is the standard for complex detail pages. Accordions are wrong for high-frequency workflow actions.

---

## 1. Tab System

Replace the SmartButtonsRow scroll-anchor behavior with real content-switching tabs.

**6 tabs** (same as current): Products, Components, Job Cards, Procurement, Documents, Issue Stock — each with count badges.

### Behavior
- Clicking a tab **replaces** the content area below (no scroll anchoring, no accordions)
- Active tab: `border-b-2 border-primary text-primary font-medium`
- URL syncs via `?tab=issue-stock` query param for deep linking / back-button
- **Products** is the default tab (no param = Products)

### Always visible above tabs
- Header stripe: back arrow, PO# (editable), status badge, due date picker
- Subheader: customer name | created date | total amount
- Tab bar

### Removed
- `CollapsibleSection` wrappers (no more accordions for top-level sections)
- Section reordering logic (`activeSection`, sorted array, `openSections` state)
- Scroll-anchor behavior from SmartButtonsRow

### Tab → Content mapping

| Tab | Content |
|-----|---------|
| Products (default) | Two-column layout (see Section 2) |
| Components | Existing BOM/component requirements view |
| Job Cards | `<JobCardsTab>` as-is |
| Procurement | `<ProcurementTab>` as-is |
| Documents | `<OrderDocumentsTab>` as-is |
| Issue Stock | `<IssueStockTab>` with enhancements (see Section 5) |

---

## 2. Products Tab — Two-Column Layout

When Products tab is active, use a responsive two-column layout.

### Left column (~65-70% width)
1. **Products table** — existing product list with Add Products button, expandable BOM rows
2. **Stock Reservations** — Reserve Stock / Release / Ship buttons with summary
3. **BOM/Components summary** — compact coverage % or "No BOM defined" with Order Components button
4. **Pricing** — Subtotal, Tax (15%), Total

### Right sidebar (~30-35% width)
1. **Customer Order Documents** — thumbnail previews of documents tagged "Customer Order". Clickable to open full view. If none, show "No customer order attached" with quick-upload dropzone.
2. **Order Progress** — compact status indicators:
   - Stock issuance: "3/5 components issued" with mini progress bar
   - Job cards: "2 active, 1 complete"
   - Procurement: "1 PO pending"
3. **Quick Actions** — small buttons: "Issue Stock" (switches to tab), "Create Job Card" (switches to tab)

### Responsive
On screens < `lg` (1024px), sidebar stacks below main content.

---

## 3. Light Mode Visual Hierarchy

### Page background
Set main content area to `bg-muted/30` so white cards visually float. Dark mode is already fine.

### Card treatment
Section cards get `bg-card shadow-sm border` — shadow + border gives depth in light mode.

### Section headers
Cards use `bg-muted/50` background stripe on headers. Within tabs, section titles use `text-base font-semibold` with `border-l-2 border-primary pl-3` left accent on key sections.

### Tab bar
Clean bottom border. Active: `border-b-2 border-primary`. Inactive: `text-muted-foreground`.

### Spacing
`gap-5` between major sections (up from `gap-3`).

### Action cards
High-frequency areas (Stock Reservations, Issue Stock) get `border-l-3 border-primary/50` left accent.

---

## 4. Orders List — Issuance Status Column

Add "Issued" column to the orders list table at `/orders`.

### Data
Single batch query joining `order_details` → `product_components` and `stock_issuances` for all visible orders. Returns: components required vs components issued per order.

### Display
Fraction format: `"3/5"` with color coding:
- **Green** (`text-green-600`): fully issued (5/5)
- **Amber** (`text-amber-600`): partially issued (3/5)
- **Gray** (`text-muted-foreground`): not started (0/5) or no BOM (—)

### Position
After "Items" column, before "Supplier".

---

## 5. Issue Stock Tab Optimizations

Optimize the Issue Stock tab for the person issuing stock all day.

### Layout changes
1. **Auto-select all products** when products exist — most common workflow is issuing everything
2. **Components table is the hero** — columns: Component | Required Qty | In Stock | Already Issued | To Issue (editable, defaults to remaining)
3. **Prominent Issue button** — large primary button at top-right of section
4. **Compact metadata row** — Issue To, PO ID, Notes in a single horizontal row (optional fields shouldn't dominate)
5. **Issuance History** always visible below — table of past issuances with date, who, what, qty, reverse action

### Implementation
Mostly a layout/styling pass on existing `IssueStockTab.tsx`. Auto-select is the only logic change.

---

## Priority Order

1. **Highest:** Convert tab strip to real content-switching tabs
2. **High:** Light mode visual hierarchy
3. **Medium:** Two-column layout for Products/Overview tab
4. **Medium:** Issuance status column on orders list
5. **Lower:** Issue Stock tab optimizations

## Technical Decisions

- **Approach A** (in-place tab conversion): Reuse existing components, client-side tab state with `?tab=` URL sync
- **No routing changes** — tabs are `useState` + `useSearchParams`, not filesystem routes
- **No new dependencies** — use existing shadcn Tabs component or simple conditional rendering
- **Existing tab components** (`IssueStockTab`, `JobCardsTab`, `ProcurementTab`, `OrderDocumentsTab`) are already extracted — just stop rendering them simultaneously
