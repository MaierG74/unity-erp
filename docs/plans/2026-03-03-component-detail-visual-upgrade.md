# Component Detail Page Visual Upgrade — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the Component detail page up to the same visual quality as the Orders page — subtle gray canvas, sidebar, colored stat cards, accent borders, sticky header.

**Architecture:** The main page wrapper gets `bg-muted/30` and a sticky header. Overview and Orders tabs use a 2-column grid layout with a right sidebar. The sidebar is a new `ComponentSidebar` component rendering different content based on the active tab. Other tabs stay full-width but benefit from the page background.

**Tech Stack:** React, Tailwind CSS, shadcn/ui Card components, existing Supabase queries.

**Design doc:** `docs/plans/2026-03-03-component-detail-visual-upgrade-design.md`

---

### Task 1: Page Wrapper + Sticky Header

**Files:**
- Modify: `app/inventory/components/[id]/page.tsx:185-216`

**Step 1: Add bg-muted/30 wrapper and sticky header**

Change the return JSX from:

```tsx
return (
  <div className="max-w-7xl space-y-4">
    {/* Header */}
    <div className="flex justify-between items-center">
      ...header content...
    </div>

    {/* Tabs */}
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList>
        ...tabs...
      </TabsList>
```

To:

```tsx
return (
  <div className="max-w-7xl space-y-5 bg-muted/30 -mx-4 md:-mx-6 px-4 md:px-6 min-h-screen">
    {/* Sticky Header */}
    <div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 pt-2 pb-0 space-y-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b shadow-sm">
      {/* Header row */}
      <div className="flex justify-between items-center">
        ...header content unchanged...
      </div>

      {/* Tab triggers inside sticky area */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-0">
        <TabsList>
          ...tabs unchanged...
        </TabsList>
      </Tabs>
    </div>

    {/* Tab content outside sticky area */}
    <Tabs value={activeTab} onValueChange={setActiveTab}>
```

Note: You'll need to lift `activeTab` to state since the TabsList and TabsContent are now in separate DOM containers:

```tsx
const [activeTab, setActiveTab] = useState('overview');
```

And import `useState` (already imported).

**Step 2: Verify the page renders**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```
feat(inventory): add bg-muted/30 wrapper and sticky header to component detail
```

---

### Task 2: Create ComponentSidebar

**Files:**
- Create: `components/features/inventory/component-detail/ComponentSidebar.tsx`

**Step 1: Create the sidebar component**

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Package,
  ShoppingCart,
  Users,
  AlertTriangle,
  Edit,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type ComponentData = {
  component_id: number;
  internal_code: string;
  inventory: {
    quantity_on_hand: number;
    reorder_level: number | null;
    location: string | null;
  } | null;
  supplierComponents: Array<{
    supplier_component_id: number;
    supplier_id: number;
    supplier_code: string;
    price: number;
    supplier: {
      supplier_id: number;
      name: string;
    };
  }>;
  on_order_quantity?: number;
  required_for_orders?: number;
};

interface ComponentSidebarProps {
  component: ComponentData;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onEdit: () => void;
}

export function ComponentSidebar({ component, activeTab, onTabChange, onEdit }: ComponentSidebarProps) {
  const inventory = component.inventory;
  const qtyOnHand = inventory?.quantity_on_hand ?? 0;
  const reorderLevel = inventory?.reorder_level ?? 0;
  const onOrder = component.on_order_quantity ?? 0;
  const required = component.required_for_orders ?? 0;
  const shortfall = Math.max(0, required - qtyOnHand - onOrder);

  if (activeTab === 'overview') {
    return (
      <div className="space-y-4">
        {/* Stock Summary */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Stock Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">In Stock</span>
              <span className={cn('font-medium', qtyOnHand <= 0 ? 'text-red-600' : qtyOnHand <= reorderLevel ? 'text-amber-600' : 'text-green-600')}>
                {qtyOnHand}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Reorder Level</span>
              <span className="font-medium">{reorderLevel}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">On Order</span>
              <span className={cn('font-medium', onOrder > 0 ? 'text-blue-600' : 'text-muted-foreground')}>
                {onOrder}
              </span>
            </div>
            {shortfall > 0 && (
              <div className="flex items-center justify-between text-sm pt-1 border-t">
                <span className="text-muted-foreground">Shortfall</span>
                <span className="font-medium text-red-600">{shortfall}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Supplier Links */}
        {component.supplierComponents.length > 0 && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Suppliers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {component.supplierComponents.slice(0, 3).map((sc) => (
                <Link
                  key={sc.supplier_component_id}
                  href={`/purchasing/suppliers/${sc.supplier_id}`}
                  className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50 transition-colors text-sm"
                >
                  <span className="truncate">{sc.supplier.name}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                </Link>
              ))}
              {component.supplierComponents.length > 3 && (
                <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onTabChange('suppliers')}>
                  View all {component.supplierComponents.length} suppliers
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={onEdit}>
              <Edit className="h-4 w-4" />
              Edit Component
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onTabChange('transactions')}>
              <Package className="h-4 w-4" />
              View Transactions
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onTabChange('orders')}>
              <ShoppingCart className="h-4 w-4" />
              View Orders
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeTab === 'orders') {
    return (
      <div className="space-y-4">
        {/* Stock Position */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              Stock Position
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">In Stock</span>
              <span className={cn('font-medium', qtyOnHand <= 0 ? 'text-red-600' : 'text-green-600')}>
                {qtyOnHand}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">On Order</span>
              <span className={cn('font-medium', onOrder > 0 ? 'text-blue-600' : 'text-muted-foreground')}>
                {onOrder}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Required</span>
              <span className={cn('font-medium', required > 0 ? 'text-purple-600' : 'text-muted-foreground')}>
                {required}
              </span>
            </div>
            {shortfall > 0 && (
              <div className="flex items-center justify-between text-sm pt-1 border-t">
                <span className="text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-red-500" />
                  Shortfall
                </span>
                <span className="font-medium text-red-600">{shortfall}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onTabChange('suppliers')}>
              <Users className="h-4 w-4" />
              View Suppliers
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onTabChange('analytics')}>
              <AlertTriangle className="h-4 w-4" />
              View Analytics
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(inventory): create ComponentSidebar for overview and orders tabs
```

---

### Task 3: Wire Sidebar into Page Layout

**Files:**
- Modify: `app/inventory/components/[id]/page.tsx`

**Step 1: Import and render sidebar**

Add import:
```tsx
import { ComponentSidebar } from '@/components/features/inventory/component-detail/ComponentSidebar';
```

For Overview and Orders `TabsContent`, wrap in a grid with sidebar:

```tsx
<TabsContent value="overview">
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
    <OverviewTab component={componentData} />
    <div className="hidden lg:block">
      <ComponentSidebar
        component={componentData}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onEdit={() => setEditDialogOpen(true)}
      />
    </div>
  </div>
</TabsContent>

<TabsContent value="orders">
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
    <OrdersTab component={componentData} />
    <div className="hidden lg:block">
      <ComponentSidebar
        component={componentData}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onEdit={() => setEditDialogOpen(true)}
      />
    </div>
  </div>
</TabsContent>
```

Suppliers, Transactions, Analytics stay as-is (full-width).

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(inventory): wire ComponentSidebar into overview and orders tabs
```

---

### Task 4: Colored Gradient Stat Cards on Orders Tab

**Files:**
- Modify: `components/features/inventory/component-detail/OrdersTab.tsx:247-288`

**Step 1: Add gradient backgrounds to stat cards**

Replace the three `<Card>` wrappers:

On Order card:
```tsx
<Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
```

Required card:
```tsx
<Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border-purple-200 dark:border-purple-800">
```

Used In card:
```tsx
<Card className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/30 dark:to-slate-700/20 border-slate-200 dark:border-slate-700">
```

Also update the "Used In" text color to match:
```tsx
<div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{products.length}</div>
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(inventory): add colored gradient backgrounds to orders tab stat cards
```

---

### Task 5: Accent Borders on Section Cards (Orders Tab)

**Files:**
- Modify: `components/features/inventory/component-detail/OrdersTab.tsx:291-499`

**Step 1: Add left accent borders to section cards**

Purchase Orders card (line ~292):
```tsx
<Card className="shadow-sm border-l-3 border-l-blue-500/40">
```

Bill of Materials card (line ~415):
```tsx
<Card className="shadow-sm border-l-3 border-l-emerald-500/40">
```

Active Orders card (line ~447):
```tsx
<Card className="shadow-sm border-l-3 border-l-purple-500/40">
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(inventory): add color-coded accent borders to orders tab sections
```

---

### Task 6: Polish Remaining Tabs

**Files:**
- Modify: `components/features/inventory/component-detail/SuppliersTab.tsx` — add `shadow-sm` to cards
- Modify: `components/features/inventory/component-detail/TransactionsTab.tsx` — add `shadow-sm` to cards
- Modify: `components/features/inventory/component-detail/AnalyticsTab.tsx` — add `shadow-sm` to cards
- Modify: `components/features/inventory/component-detail/OverviewTab.tsx` — add `shadow-sm` to main info card and suppliers card

**Step 1: Add shadow-sm to all Card components that don't have it**

For each tab file, find `<Card>` or `<Card className="...">` and ensure `shadow-sm` is present. The gradient cards in OverviewTab already pop against bg-muted/30, but plain cards need the subtle shadow.

Examples:
- OverviewTab line 90: `<Card>` → `<Card className="shadow-sm">`
- OverviewTab line 260: `<Card>` → `<Card className="shadow-sm">`
- OrdersTab line 504: Empty state card → `<Card className="shadow-sm">`

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
feat(inventory): add shadow-sm to all tab cards for visual consistency
```

---

### Task 7: Visual Verification

**Step 1: Run type check and lint**

```bash
npx tsc --noEmit && npm run lint
```

**Step 2: Test in browser**

Navigate to `http://localhost:3000/inventory/components/751` and verify:
- Dark mode: bg-muted/30 canvas visible, cards pop against background
- Light mode: Same depth effect with lighter tones
- Overview tab: Sidebar with stock summary, supplier links, quick actions
- Orders tab: Gradient stat cards, accent borders, sidebar with stock position
- Suppliers/Transactions/Analytics tabs: Full-width, cards have shadow-sm
- Sticky header: Title + tabs stay visible on scroll
- Responsive: Sidebar hides on mobile (< lg breakpoint)

**Step 3: Take screenshots for verification**

**Step 4: Final commit if any touchups needed**
