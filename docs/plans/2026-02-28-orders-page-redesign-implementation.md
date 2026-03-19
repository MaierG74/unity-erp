# Orders Page Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the orders detail page from a tab-based layout into a single-scroll page with smart buttons, compact header stripe, inline BOM per product row, per-line stock reservations, collapsible sections, and an optional slide-out panel.

**Architecture:** The page (`app/orders/[orderId]/page.tsx`, 1,893 lines) currently uses `<Tabs>` with 6 `<TabsContent>` sections. We'll replace the `<Tabs>` wrapper with a flat scroll layout. Navigation becomes a row of badge-like "smart buttons" that scroll-to or open sections. The slide-out panel uses the existing shadcn `<Sheet>` component (already in `components/ui/sheet.tsx`). All data-fetching, mutations, and extracted components remain unchanged.

**Tech Stack:** Next.js 16 (App Router), React Query, shadcn/ui, Tailwind CSS, Lucide icons, Sonner toasts

**Design doc:** `docs/plans/2026-02-28-orders-page-redesign.md`

---

## Task 1: Create the OrderHeaderStripe component

Replace the bulky Order Summary card (lines 780–960) and the current header (lines 731–754) with a single ultra-compact stripe.

**Files:**
- Create: `components/features/orders/OrderHeaderStripe.tsx`
- Modify: `app/orders/[orderId]/page.tsx`

**Step 1: Create OrderHeaderStripe component**

Create `components/features/orders/OrderHeaderStripe.tsx`:

```tsx
'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, ChevronsUpDown, Check, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { formatCurrency } from '@/lib/format-utils';

interface OrderHeaderStripeProps {
  orderId: number;
  order: any; // The full order object from React Query
  customers: any[];
  customersLoading: boolean;
  editCustomerId: string;
  editOrderNumber: string;
  editDeliveryDate: string;
  statusOptions: any[];
  updateOrderMutation: any;
  updateStatusMutation: any;
  onCustomerChange: (customerId: string) => void;
  onOrderNumberChange: (value: string) => void;
  onOrderNumberBlur: () => void;
  onDeliveryDateChange: (date: string) => void;
}
```

The component renders:
- Back button + `PO#` title + StatusBadge (as dropdown to change status) + delivery badge
- Below that, a single metadata line: `Customer | Order date | Due date | Total`
- All fields are inline-editable on click (customer via Popover, PO# via Input, delivery via date Input, status via dropdown)

**Step 2: Run `npx tsc --noEmit` to verify no type errors**

**Step 3: Commit**

```bash
git add components/features/orders/OrderHeaderStripe.tsx
git commit -m "feat(orders): add OrderHeaderStripe component for compact metadata display"
```

---

## Task 2: Create the SmartButtonsRow component

Replace the `<TabsList>` (lines 757–764) with badge-like smart buttons showing counts.

**Files:**
- Create: `components/features/orders/SmartButtonsRow.tsx`

**Step 1: Create SmartButtonsRow component**

Create `components/features/orders/SmartButtonsRow.tsx`:

```tsx
'use client';

import React from 'react';
import { Package, Wrench, ClipboardList, FileText, ShoppingCart, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SmartButton {
  id: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  variant?: 'default' | 'warning' | 'danger';
}

interface SmartButtonsRowProps {
  productCount: number;
  componentShortfallCount: number;
  jobCardCount: number;
  poCount: number;
  documentCount: number;
  issuedCount: number;
  onButtonClick: (sectionId: string) => void;
  activeSection?: string | null;
}
```

Each button renders as a pill: `📦 Products (3)` with a subtle background color. Clicking scrolls to the matching section ref. Active section gets a highlighted border.

The component uses `scrollIntoView({ behavior: 'smooth', block: 'start' })` via passed-in click handler.

**Step 2: Run `npx tsc --noEmit` to verify no type errors**

**Step 3: Commit**

```bash
git add components/features/orders/SmartButtonsRow.tsx
git commit -m "feat(orders): add SmartButtonsRow component for section navigation"
```

---

## Task 3: Create the ProductsTableRow component with expandable BOM

Extract per-row rendering from the products table (lines 1098–1239) into its own component, adding expandable BOM rows inline.

**Files:**
- Create: `components/features/orders/ProductsTableRow.tsx`

**Step 1: Create ProductsTableRow component**

This component renders a single product row with:
- Expand/collapse chevron in the first column
- Product name, description
- Qty (inline-editable), Reserved, To Build, Unit Price (inline-editable), Total
- Edit/Delete action buttons
- When expanded: nested rows showing BOM components for that product (from `componentRequirements` data, filtered to this product's `product_id`)
- Each BOM sub-row shows: component code, description, required, in-stock, on-order, shortfall — using existing `computeComponentMetrics`

Props:
```tsx
interface ProductsTableRowProps {
  detail: any;
  coverage: { ordered: number; reserved: number; remain: number; factor: number };
  isEditing: boolean;
  editQuantity: string;
  editUnitPrice: string;
  isExpanded: boolean;
  bomComponents: any[]; // Components for this product from componentRequirements
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onQuantityChange: (value: string) => void;
  onUnitPriceChange: (value: string) => void;
  updatePending: boolean;
  deletePending: boolean;
}
```

**Step 2: Run `npx tsc --noEmit` to verify no type errors**

**Step 3: Commit**

```bash
git add components/features/orders/ProductsTableRow.tsx
git commit -m "feat(orders): add ProductsTableRow with expandable BOM components"
```

---

## Task 4: Create the SlideOutPanel component

Build a right-side Sheet panel for deep-dive per line item.

**Files:**
- Create: `components/features/orders/OrderSlideOutPanel.tsx`

**Step 1: Create OrderSlideOutPanel component**

Uses `Sheet` from `components/ui/sheet.tsx`. When a product row is selected (click on product name or a "details" icon), the panel slides in from the right showing:
- Product name + description header
- BOM breakdown table (same data as expanded row, but more spacious layout)
- Procurement status for each BOM component
- Reserve/Release/Ship actions for this specific product
- Links to related job cards and purchase orders

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

interface OrderSlideOutPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProduct: any | null;
  bomComponents: any[];
  coverage: { ordered: number; reserved: number; remain: number; factor: number } | null;
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
}
```

Override the default Sheet width: `className="sm:max-w-lg"` (widen from default `sm:max-w-sm`).

**Step 2: Run `npx tsc --noEmit` to verify no type errors**

**Step 3: Commit**

```bash
git add components/features/orders/OrderSlideOutPanel.tsx
git commit -m "feat(orders): add OrderSlideOutPanel sheet for product deep-dive"
```

---

## Task 5: Create CollapsibleSection wrapper

Build a reusable wrapper for the collapsible sections (Job Cards, Procurement, Documents, Issue Stock).

**Files:**
- Create: `components/features/orders/CollapsibleSection.tsx`

**Step 1: Create CollapsibleSection component**

```tsx
'use client';

import React, { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
}
```

Uses `forwardRef` so the parent can attach a `ref` for `scrollIntoView`. Renders a bordered card-like container with the trigger as a header row (icon + title + optional header action + chevron). Content animates open/closed.

**Step 2: Run `npx tsc --noEmit` to verify no type errors**

**Step 3: Commit**

```bash
git add components/features/orders/CollapsibleSection.tsx
git commit -m "feat(orders): add CollapsibleSection reusable wrapper"
```

---

## Task 6: Rewire page.tsx — Remove Tabs, wire new layout

This is the big integration task. Replace the `<Tabs>` structure with the new single-scroll layout.

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

**Step 1: Add section refs and scroll handler**

At the top of the component (after existing state declarations, ~line 86), add:

```tsx
// Section refs for smart button scroll-to
const productsRef = useRef<HTMLDivElement>(null);
const componentsRef = useRef<HTMLDivElement>(null);
const jobCardsRef = useRef<HTMLDivElement>(null);
const procurementRef = useRef<HTMLDivElement>(null);
const documentsRef = useRef<HTMLDivElement>(null);
const issueStockRef = useRef<HTMLDivElement>(null);

// Slide-out panel state
const [slideOutProduct, setSlideOutProduct] = useState<any>(null);

// Section open/close state (all collapsed by default except Products)
const [openSections, setOpenSections] = useState<Record<string, boolean>>({
  'job-cards': false,
  'procurement': false,
  'documents': false,
  'issue-stock': false,
});

const handleSmartButtonClick = (sectionId: string) => {
  const refMap: Record<string, React.RefObject<HTMLDivElement>> = {
    products: productsRef,
    components: componentsRef,
    'job-cards': jobCardsRef,
    procurement: procurementRef,
    documents: documentsRef,
    'issue-stock': issueStockRef,
  };
  const ref = refMap[sectionId];
  if (ref?.current) {
    // Open the section if it's collapsible
    setOpenSections(prev => ({ ...prev, [sectionId]: true }));
    // Small delay to let animation start, then scroll
    setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
};
```

**Step 2: Update imports**

Add new imports at the top of the file:
- `import { useRef } from 'react'` (add to existing React import)
- `import { OrderHeaderStripe } from '@/components/features/orders/OrderHeaderStripe'`
- `import { SmartButtonsRow } from '@/components/features/orders/SmartButtonsRow'`
- `import { ProductsTableRow } from '@/components/features/orders/ProductsTableRow'`
- `import { OrderSlideOutPanel } from '@/components/features/orders/OrderSlideOutPanel'`
- `import { CollapsibleSection } from '@/components/features/orders/CollapsibleSection'`
- `import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'`

Remove `Tabs, TabsContent, TabsList, TabsTrigger` from imports (no longer needed).

**Step 3: Replace the header section (lines 731–754)**

Replace with:
```tsx
<OrderHeaderStripe
  orderId={orderId}
  order={order}
  customers={customersSorted}
  customersLoading={customersLoading}
  editCustomerId={editCustomerId}
  editOrderNumber={editOrderNumber}
  editDeliveryDate={editDeliveryDate}
  statusOptions={statusOptions}
  updateOrderMutation={updateOrderMutation}
  updateStatusMutation={updateStatusMutation}
  onCustomerChange={handleCustomerChange}
  onOrderNumberChange={setEditOrderNumber}
  onOrderNumberBlur={handleOrderNumberBlur}
  onDeliveryDateChange={handleDeliveryDateChange}
/>
```

**Step 4: Replace TabsList (lines 756–764) with SmartButtonsRow**

```tsx
<SmartButtonsRow
  productCount={order?.details?.length || 0}
  componentShortfallCount={totals.totalShortfall}
  jobCardCount={0} // TODO: wire actual count from JobCardsTab data
  poCount={0} // TODO: wire actual count from ProcurementTab data
  documentCount={attachments?.length || 0}
  issuedCount={0} // TODO: wire actual count from IssueStockTab data
  onButtonClick={handleSmartButtonClick}
/>
```

**Step 5: Replace TabsContent blocks with flat sections**

Remove the `<Tabs>` wrapper and all `<TabsContent>` wrappers. The layout becomes:

```tsx
{/* 1. Products section — always visible, dominates viewport */}
<div ref={productsRef}>
  {/* AddProductsDialog button + Products table (existing) */}
  {/* But use ProductsTableRow for each row */}
</div>

{/* 2. Components Summary — keep existing card, slightly reduced */}

{/* 3. Financial Summary — keep existing, move to a compact inline display */}

{/* 4. Collapsible sections — all collapsed by default */}
<div ref={issueStockRef}>
  <CollapsibleSection id="issue-stock" title="Issue Stock" icon={...}
    open={openSections['issue-stock']}
    onOpenChange={(open) => setOpenSections(prev => ({...prev, 'issue-stock': open}))}>
    <IssueStockTab orderId={orderId} order={order} componentRequirements={componentRequirements} />
  </CollapsibleSection>
</div>

<div ref={documentsRef}>
  <CollapsibleSection id="documents" title="Documents" icon={...}
    open={openSections['documents']}
    onOpenChange={(open) => setOpenSections(prev => ({...prev, 'documents': open}))}>
    <OrderDocumentsTab orderId={orderId} />
  </CollapsibleSection>
</div>

<div ref={procurementRef}>
  <CollapsibleSection id="procurement" title="Procurement" icon={...}
    open={openSections['procurement']}
    onOpenChange={(open) => setOpenSections(prev => ({...prev, 'procurement': open}))}>
    <ProcurementTab orderId={orderId} />
  </CollapsibleSection>
</div>

<div ref={jobCardsRef}>
  <CollapsibleSection id="job-cards" title="Job Cards" icon={...}
    open={openSections['job-cards']}
    onOpenChange={(open) => setOpenSections(prev => ({...prev, 'job-cards': open}))}>
    <JobCardsTab orderId={orderId} />
  </CollapsibleSection>
</div>

{/* 5. Slide-out panel */}
<OrderSlideOutPanel
  open={!!slideOutProduct}
  onOpenChange={(open) => !open && setSlideOutProduct(null)}
  selectedProduct={slideOutProduct}
  bomComponents={...}
  coverage={...}
  computeComponentMetrics={computeComponentMetrics}
  showGlobalContext={showGlobalContext}
/>
```

**Step 6: Remove the Order Summary card (lines 780–960)**

This is now handled by `OrderHeaderStripe`. Delete the entire `<Card>` block.

**Step 7: Remove the FG Reservations collapsible from details tab**

The FG reservations block (lines 960–1097) moves into the per-product-row display and the slide-out panel. Remove the standalone block.

**Step 8: Remove the Components tab content (lines 1423–1837)**

The component requirements view is now accessible via the Components Summary card "View All" button (which opens the slide-out or scrolls to an expanded Components section). The inline BOM rows in ProductsTableRow serve the same purpose at a glance.

Keep the `componentRequirements` query and `computeComponentMetrics` — they're still used by ProductsTableRow.

**Step 9: Remove `activeTab`, `handleTabChange`, and tab-related state**

Remove:
- `const [activeTab, setActiveTab] = useState<string>(initialTab);`
- `const handleTabChange = (value: string) => { ... };`
- The `?tab=` query param logic
- All `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger` JSX

**Step 10: Run `npx tsc --noEmit` and `npm run lint`**

Fix any type errors or lint issues.

**Step 11: Commit**

```bash
git add app/orders/[orderId]/page.tsx
git commit -m "feat(orders): replace tab layout with single-scroll smart-buttons design"
```

---

## Task 7: Visual polish and sticky header

**Files:**
- Modify: `components/features/orders/OrderHeaderStripe.tsx`
- Modify: `components/features/orders/SmartButtonsRow.tsx`
- Modify: `app/orders/[orderId]/page.tsx`

**Step 1: Make header stripe sticky**

Add `sticky top-0 z-10 bg-background/95 backdrop-blur` to the header stripe's outer div so it stays visible during scroll.

**Step 2: Make smart buttons row sticky below header**

Add `sticky top-[header-height] z-10 bg-background/95 backdrop-blur` to the smart buttons row.

**Step 3: Add section dividers and spacing**

Ensure clean visual separation between Products section, Components Summary, Financial Summary, and the collapsible sections. Use `<Separator />` or `border-t` with adequate padding.

**Step 4: Run `npx tsc --noEmit` and `npm run lint`**

**Step 5: Preview with screenshot to verify layout**

Use `preview_screenshot` and `preview_snapshot` to confirm:
- Header stripe is sticky and compact
- Smart buttons show correct counts
- Products table dominates viewport
- Collapsible sections start collapsed
- Clicking smart button scrolls to section

**Step 6: Commit**

```bash
git add -A
git commit -m "style(orders): sticky header, smart buttons polish, section spacing"
```

---

## Task 8: Wire smart button counts

Currently Job Cards, POs, and Issue Stock counts are hardcoded to 0. We need real counts.

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`
- Potentially modify: `lib/queries/order-queries.ts` (if a lightweight count query is needed)

**Step 1: Add count queries or derive from existing data**

Options (pick the simplest):
- **Job Cards:** Add a simple count query `select count from job_cards where order_id = ?`
- **POs:** Derive from `componentRequirements` or add query
- **Issued:** Derive from `fgReservations` length or a separate query

Add these as `useQuery` hooks or lightweight `supabase.from(...).select('id', { count: 'exact', head: true })`.

**Step 2: Pass counts to SmartButtonsRow**

**Step 3: Run `npx tsc --noEmit`**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(orders): wire real counts to smart buttons"
```

---

## Task 9: Final verification and cleanup

**Files:**
- All modified files

**Step 1: Run full type check**

```bash
npx tsc --noEmit
```

**Step 2: Run linter**

```bash
npm run lint
```

**Step 3: Visual verification**

Use Chrome DevTools MCP or preview tools:
- Navigate to an order with products, BOM, and reservations
- Verify header stripe shows all metadata
- Verify smart buttons show counts and scroll works
- Verify products table with expandable BOM rows
- Verify collapsible sections open/close
- Verify slide-out panel opens for a product
- Verify inline editing still works (customer, PO#, delivery date, qty, price)
- Verify all mutations still work (reserve, release, ship, delete product)

**Step 4: Check for pre-existing errors only**

Confirm no NEW errors introduced. The 5 pre-existing errors (Customer type mismatch, `on_order` property) are known and acceptable.

**Step 5: Commit final state**

```bash
git add -A
git commit -m "chore(orders): final verification of orders page redesign"
```

---

## Summary of new files

| File | Purpose |
|------|---------|
| `components/features/orders/OrderHeaderStripe.tsx` | Compact metadata stripe replacing Order Summary card |
| `components/features/orders/SmartButtonsRow.tsx` | Badge-like navigation buttons with counts |
| `components/features/orders/ProductsTableRow.tsx` | Product row with expandable inline BOM |
| `components/features/orders/OrderSlideOutPanel.tsx` | Right-side Sheet for product deep-dive |
| `components/features/orders/CollapsibleSection.tsx` | Reusable collapsible wrapper for sections |

## Files modified

| File | Changes |
|------|---------|
| `app/orders/[orderId]/page.tsx` | Remove Tabs, wire new components, add refs + scroll logic |

## Files unchanged

All extracted modules from Phase 1 (`order-queries.ts`, `order-components.ts`, `OrderComponentsDialog.tsx`, `AddProductsDialog.tsx`, `StatusBadge.tsx`, `format-utils.ts`) remain untouched. The existing tab components (`IssueStockTab`, `OrderDocumentsTab`, `ProcurementTab`, `JobCardsTab`) are reused inside `CollapsibleSection` wrappers.
