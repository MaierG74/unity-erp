# Order Components Tab Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the sparse Components tab with a full flat component table matching the Products tab's column layout, plus a go/no-go status badge.

**Architecture:** All data is already fetched by `fetchOrderComponentRequirements`. We add a `useMemo` to deduplicate components across products and sum their required quantities, then render a full table inside the existing Components tab block. No new queries, no new files — purely a UI replacement in `app/orders/[orderId]/page.tsx`.

**Tech Stack:** React, Next.js, Tailwind CSS, shadcn/ui, lucide-react icons

**Design doc:** `docs/plans/2026-03-03-order-components-tab-design.md`

---

### Task 1: Add deduplicated component list memo

**Files:**
- Modify: `app/orders/[orderId]/page.tsx:646-718`

**Step 1: Add the deduplication memo after the existing `totals` memo**

Insert this `useMemo` right after line 718 (after the `totals` memo closing):

```tsx
// Flat deduplicated component list for the Components tab
const flatComponents = useMemo(() => {
  const map = new Map<number, {
    component_id: number;
    internal_code: string;
    description: string;
    totalRequired: number;
    inStock: number;
    onOrder: number;
    reservedThisOrder: number;
    reservedByOthers: number;
    available: number;
    apparent: number;
    real: number;
  }>();

  componentRequirements.forEach((productReq: ProductRequirement) => {
    (productReq.components ?? []).forEach((component: any) => {
      const metrics = computeComponentMetrics(component, productReq.product_id);
      const id = component.component_id;
      if (!id) return;

      const existing = map.get(id);
      if (existing) {
        // Sum required across products; stock metrics are component-level (same values)
        existing.totalRequired += metrics.required;
        existing.apparent = Math.max(0, existing.totalRequired - existing.available);
        existing.real = Math.max(0, existing.totalRequired - existing.available - existing.onOrder);
      } else {
        map.set(id, {
          component_id: id,
          internal_code: component.internal_code || 'Unknown',
          description: component.description || '',
          totalRequired: metrics.required,
          inStock: metrics.inStock,
          onOrder: metrics.onOrder,
          reservedThisOrder: metrics.reservedThisOrder,
          reservedByOthers: metrics.reservedByOthers,
          available: metrics.available,
          apparent: metrics.apparent,
          real: metrics.real,
        });
      }
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    // Shortfall items first (descending), then by code
    if (b.real !== a.real) return b.real - a.real;
    return a.internal_code.localeCompare(b.internal_code);
  });
}, [componentRequirements, computeComponentMetrics]);
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 3: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): add deduplicated flat component list memo"
```

---

### Task 2: Replace Components tab rendering

**Files:**
- Modify: `app/orders/[orderId]/page.tsx:1081-1215`

**Step 1: Add ExternalLink icon import**

At the top of the file, in the lucide-react import line, add `ExternalLink` to the destructured icons if not already present.

**Step 2: Replace the Components tab block**

Replace everything between `{activeTab === 'components' && (` (line 1081) and the matching closing `)}` (line 1215) with:

```tsx
{activeTab === 'components' && (
  <div ref={componentsRef} className="space-y-5">
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Components Summary
                {totals.totalComponents > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-medium',
                      totals.totalShortfall > 0
                        ? 'border-red-600 text-red-600 bg-red-500/10'
                        : totals.componentsPendingDeliveries > 0
                          ? 'border-amber-600 text-amber-600 bg-amber-500/10'
                          : 'border-green-600 text-green-600 bg-green-500/10'
                    )}
                  >
                    {totals.totalShortfall > 0
                      ? 'Shortfall'
                      : totals.componentsPendingDeliveries > 0
                        ? 'Partial'
                        : 'Ready'}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>Parts needed to fulfill this order</CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setOrderComponentsOpen(true)}
          >
            Order Components
            <ShoppingCart className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stock Coverage Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Stock Availability</span>
            <span className={cn(
              "font-semibold",
              totals.stockCoverage === 100 ? "text-green-600" : totals.stockCoverage >= 50 ? "text-amber-600" : "text-red-600"
            )}>
              {totals.stockCoverage}% ready
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-500",
                totals.stockCoverage === 100 ? "bg-green-500" : totals.stockCoverage >= 50 ? "bg-amber-500" : "bg-red-500"
              )}
              style={{ width: `${totals.stockCoverage}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{totals.componentsInStock} in stock</span>
            {totals.componentsPendingDeliveries > 0 && (
              <span className="text-amber-600">{totals.componentsPendingDeliveries} on order</span>
            )}
            {totals.totalShortfall > 0 && (
              <span className="text-red-600 font-medium">{totals.totalShortfall} short</span>
            )}
          </div>
        </div>

        {/* Full Component Table */}
        {flatComponents.length > 0 ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-muted-foreground">
                  <th className="text-left py-2 px-3 font-medium">Component</th>
                  <th className="text-right py-2 px-3 font-medium">Required</th>
                  <th className="text-right py-2 px-3 font-medium">In Stock</th>
                  <th className="text-right py-2 px-3 font-medium">Reserved</th>
                  <th className="text-right py-2 px-3 font-medium">Available</th>
                  <th className="text-right py-2 px-3 font-medium">On Order</th>
                  <th className="text-right py-2 px-3 font-medium">Shortfall</th>
                </tr>
              </thead>
              <tbody>
                {flatComponents.map((comp, idx) => (
                  <tr
                    key={comp.component_id}
                    className={cn(
                      'border-t transition-colors',
                      comp.real > 0
                        ? 'bg-red-500/5 hover:bg-red-500/10'
                        : comp.apparent > 0
                          ? 'bg-amber-500/5 hover:bg-amber-500/10'
                          : 'hover:bg-muted/50'
                    )}
                  >
                    <td className="py-2 px-3">
                      <Link
                        href={`/inventory/components/${comp.component_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-baseline gap-2 hover:underline group"
                      >
                        <span className="font-medium">{comp.internal_code}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {comp.description}
                        </span>
                        <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </Link>
                    </td>
                    <td className="text-right py-2 px-3 font-medium tabular-nums">
                      {formatQuantity(comp.totalRequired)}
                    </td>
                    <td className="text-right py-2 px-3 tabular-nums">
                      {formatQuantity(comp.inStock)}
                    </td>
                    <td className={cn(
                      'text-right py-2 px-3 tabular-nums',
                      comp.reservedThisOrder > 0 ? 'text-blue-500 font-medium' : 'text-muted-foreground'
                    )}>
                      {formatQuantity(comp.reservedThisOrder)}
                    </td>
                    <td className={cn(
                      'text-right py-2 px-3 tabular-nums',
                      comp.available < comp.totalRequired ? 'text-orange-500 font-medium' : ''
                    )}>
                      {formatQuantity(comp.available)}
                    </td>
                    <td className="text-right py-2 px-3 tabular-nums">
                      {formatQuantity(comp.onOrder)}
                    </td>
                    <td className={cn(
                      'text-right py-2 px-3 font-medium tabular-nums',
                      comp.real > 0 ? 'text-red-600' : 'text-green-600'
                    )}>
                      {formatQuantity(comp.real)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : totals.totalComponents === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <p>No bill of materials defined for products in this order</p>
          </div>
        ) : null}

        {/* All good / partial messages */}
        {totals.totalShortfall === 0 && totals.totalComponents > 0 && totals.componentsPendingDeliveries === 0 && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-500/10 rounded-lg p-3">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">All components available in stock</span>
          </div>
        )}
        {totals.totalShortfall === 0 && totals.totalComponents > 0 && totals.componentsPendingDeliveries > 0 && (
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 bg-amber-500/10 rounded-lg p-3">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">
              All components will be available once pending deliveries arrive for {totals.componentsPendingDeliveries === 1
                ? '1 component'
                : `${totals.componentsPendingDeliveries} components`}.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  </div>
)}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 4: Verify in browser**

Open `localhost:3000/orders/321?tab=components` and confirm:
- Go/no-go badge appears (should show "Shortfall" in red for this test order)
- Progress bar + compact summary counts render
- Full table shows ALL components (WIDGET + WID2), not just shortfalls
- Clicking a component opens inventory page in new tab
- Shortfall rows have red tint, on-order rows have amber tint
- Columns match: Component, Required, In Stock, Reserved, Available, On Order, Shortfall

**Step 5: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): replace Components tab with full flat component table and status badge"
```

---

### Task 3: Verify and lint

**Step 1: Run linter**

Run: `npm run lint`
Expected: No new warnings or errors

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: Clean

**Step 3: Visual check in browser**

Navigate to `localhost:3000/orders/321?tab=components` and take a screenshot to verify the final result.
