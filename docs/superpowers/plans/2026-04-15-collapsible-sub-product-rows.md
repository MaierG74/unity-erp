# Collapsible Sub-Product Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group linked (phantom) sub-product BOM/BOL items under collapsible summary rows in the Materials and Labor tabs of product costing, so users can instantly identify which items belong to a sub-assembly.

**Architecture:** Both `product-bom.tsx` and `product-bol.tsx` already receive `_source` and `_sub_product_id` metadata on effective BOM/BOL items. We partition items into direct vs linked groups, render direct items as normal rows, and render each linked group as a collapsible section with a teal-highlighted header row. A shared `SubProductGroupHeader` component handles the expand/collapse toggle, badge, item count, and link-out. No API changes needed.

**Tech Stack:** React, Tailwind CSS v4, shadcn/ui Table components, existing `product_bom_links` query data.

**Spec:** `docs/superpowers/specs/2026-04-15-collapsible-sub-product-rows-design.md`

---

### Task 1: Create SubProductGroupHeader Component

**Files:**
- Create: `components/features/products/SubProductGroupHeader.tsx`

This shared component renders the collapsible header row used in both Materials and Labor tables.

- [ ] **Step 1: Create the component file**

```tsx
// components/features/products/SubProductGroupHeader.tsx
'use client'

import { useState } from 'react'
import { TableRow, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface SubProductGroupHeaderProps {
  productId: number
  productName: string
  productCode: string
  itemCount: number
  totalCost: number
  scaleQty: number
  colSpan: number
  defaultExpanded?: boolean
  children: React.ReactNode
}

export function SubProductGroupHeader({
  productId,
  productName,
  productCode,
  itemCount,
  totalCost,
  scaleQty,
  colSpan,
  defaultExpanded = false,
  children,
}: SubProductGroupHeaderProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <>
      {/* Header row */}
      <TableRow
        className="cursor-pointer bg-teal-500/8 hover:bg-teal-500/12 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell colSpan={colSpan - 2}>
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-teal-400 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-teal-400 shrink-0" />
            )}
            <Badge
              variant="outline"
              className="border-teal-500/30 bg-teal-500/15 text-teal-400 text-[10px] font-semibold px-2 py-0"
            >
              SUB-PRODUCT
            </Badge>
            <a
              href={`/products/${productId}?tab=costing`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sm hover:underline text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              {productName || productCode}
            </a>
            <span className="text-xs text-muted-foreground">
              · {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-right text-sm">
          {scaleQty.toFixed(2)}
        </TableCell>
        <TableCell className="text-right text-sm font-semibold text-teal-400">
          R{totalCost.toFixed(2)}
        </TableCell>
      </TableRow>

      {/* Child rows */}
      {expanded && children}
    </>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to SubProductGroupHeader

- [ ] **Step 3: Commit**

```bash
git add components/features/products/SubProductGroupHeader.tsx
git commit -m "feat: add SubProductGroupHeader component for collapsible sub-product rows"
```

---

### Task 2: Add Grouping Logic to Materials Tab (product-bom.tsx)

**Files:**
- Modify: `components/features/products/product-bom.tsx`

Replace the flat rendering of linked items with grouped collapsible sections. The key change is in the table body rendering around line 1782-1940.

- [ ] **Step 1: Add import for SubProductGroupHeader**

At the top of `components/features/products/product-bom.tsx`, add the import alongside existing imports:

```tsx
import { SubProductGroupHeader } from './SubProductGroupHeader'
```

- [ ] **Step 2: Replace flat row rendering with grouped rendering**

In `product-bom.tsx`, find the table body rendering section (inside the `{(() => {` IIFE around line 1782). After the `filteredRows` computation (around line 1812), replace the `return filteredRows.map(...)` block with grouping logic.

Replace this code (the `return filteredRows.map((it, idx) => {` block that starts around line 1824 and runs to the end of the IIFE) with:

```tsx
                      // Partition into direct rows and linked groups
                      const directRows = filteredRows.filter(
                        (r) => r._source !== 'link'
                      )
                      const linkedGroups = new Map<
                        number,
                        EffectiveBOMItem[]
                      >()
                      for (const r of filteredRows) {
                        if (
                          r._source === 'link' &&
                          typeof r._sub_product_id === 'number'
                        ) {
                          const group =
                            linkedGroups.get(r._sub_product_id) || []
                          group.push(r)
                          linkedGroups.set(r._sub_product_id, group)
                        }
                      }

                      const colSpan = supplierFeatureAvailable ? 9 : 6

                      // Helper to render a single BOM row (used for both direct and child rows)
                      const renderBomRow = (
                        it: EffectiveBOMItem,
                        idx: number,
                        isChild = false
                      ) => {
                        const comp = componentsById.get(
                          Number(it.component_id)
                        )
                        const code =
                          comp?.internal_code || String(it.component_id)
                        const desc = comp?.description || ''
                        const direct =
                          it._editable && typeof it.bom_id === 'number'
                            ? bomById.get(Number(it.bom_id))
                            : undefined
                        const linkedPrice = (it as any)?.suppliercomponents
                          ?.price
                        const directUnitPrice = direct?.supplierComponent
                          ? Number(direct.supplierComponent.price)
                          : null
                        const qty = Number(
                          it.quantity_required ||
                            direct?.quantity_required ||
                            0
                        )
                        const unitPrice =
                          directUnitPrice != null
                            ? directUnitPrice
                            : linkedPrice != null
                              ? Number(linkedPrice)
                              : null
                        const total =
                          unitPrice != null ? unitPrice * qty : null
                        const resolvedCutlistDimensions =
                          cloneCutlistDimensions(
                            direct?.cutlist_dimensions ??
                              (it as any)?.cutlist_dimensions ??
                              null
                          )
                        const resolvedCutlistCategory =
                          direct?.cutlist_category ??
                          (it as any)?.cutlist_category ??
                          null
                        const resolvedIsCutlist = Boolean(
                          direct?.is_cutlist_item ??
                            (it as any)?.is_cutlist_item ??
                            false
                        )
                        const cutlistSummary =
                          summariseCutlistDimensions(
                            resolvedCutlistDimensions
                          )
                        const hasCutlistDetails =
                          resolvedCutlistDimensions != null &&
                          Object.keys(resolvedCutlistDimensions).length > 0

                        return (
                          <TableRow
                            key={`row-${idx}`}
                            className={
                              isChild
                                ? 'border-l-2 border-l-teal-500/50'
                                : undefined
                            }
                          >
                            <TableCell
                              className={isChild ? 'pl-7' : undefined}
                            >
                              <a
                                href={`/inventory/components/${it.component_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`hover:underline ${isChild ? 'text-muted-foreground' : 'text-primary'}`}
                              >
                                {code}
                              </a>
                            </TableCell>
                            <TableCell
                              className={
                                isChild
                                  ? 'text-muted-foreground'
                                  : undefined
                              }
                            >
                              {desc}
                            </TableCell>
                            {supplierFeatureAvailable && (
                              <>
                                <TableCell
                                  className={
                                    isChild
                                      ? 'text-muted-foreground'
                                      : undefined
                                  }
                                >
                                  {direct?.supplierComponent?.supplier
                                    ?.name || '-'}
                                </TableCell>
                                <TableCell
                                  className={
                                    isChild
                                      ? 'text-muted-foreground'
                                      : undefined
                                  }
                                >
                                  {unitPrice != null
                                    ? `R${unitPrice.toFixed(2)}`
                                    : '-'}
                                </TableCell>
                              </>
                            )}
                            <TableCell
                              className={
                                isChild
                                  ? 'text-muted-foreground'
                                  : undefined
                              }
                            >
                              {qty.toFixed(2)}
                            </TableCell>
                            {supplierFeatureAvailable && (
                              <TableCell
                                className={
                                  isChild
                                    ? 'text-muted-foreground'
                                    : undefined
                                }
                              >
                                {total != null
                                  ? `R${total.toFixed(2)}`
                                  : '-'}
                              </TableCell>
                            )}
                            <TableCell className="align-top">
                              {resolvedIsCutlist ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-foreground">
                                    {cutlistSummary.headline ??
                                      'Cutlist item'}
                                  </div>
                                  {resolvedCutlistCategory ? (
                                    <div className="text-[11px] text-muted-foreground">
                                      Category: {resolvedCutlistCategory}
                                    </div>
                                  ) : null}
                                  {cutlistSummary.details.length > 0 ? (
                                    <>
                                      {cutlistSummary.details
                                        .slice(0, 2)
                                        .map((detail, detailIndex) => (
                                          <div
                                            key={`${detail}-${detailIndex}`}
                                            className="text-[11px] text-muted-foreground"
                                          >
                                            • {detail}
                                          </div>
                                        ))}
                                      {cutlistSummary.details.length >
                                        2 && (
                                        <div className="text-[11px] text-muted-foreground italic">
                                          +
                                          {cutlistSummary.details.length -
                                            2}{' '}
                                          more
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-[11px] text-amber-600">
                                      Dimensions not specified
                                    </div>
                                  )}
                                </div>
                              ) : hasCutlistDetails ? (
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-foreground">
                                    Dimensions captured
                                  </div>
                                  {cutlistSummary.details
                                    .slice(0, 2)
                                    .map((detail, detailIndex) => (
                                      <div
                                        key={`${detail}-${detailIndex}`}
                                        className="text-[11px] text-muted-foreground"
                                      >
                                        • {detail}
                                      </div>
                                    ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {isChild ? (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              ) : it._source === 'link' ? (
                                <Badge variant="outline">Linked</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Direct
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {direct ? (
                                <div className="flex items-center gap-2">
                                  <TooltipProvider delayDuration={100}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className={cn(
                                            'h-8 w-8',
                                            direct.is_substitutable
                                              ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                                              : 'text-muted-foreground'
                                          )}
                                          onClick={async (e) => {
                                            e.stopPropagation()
                                            const newValue =
                                              !direct.is_substitutable
                                            queryClient.setQueryData(
                                              ['productBOM', productId],
                                              (old: any) =>
                                                old?.map((b: any) =>
                                                  b.bom_id ===
                                                  direct.bom_id
                                                    ? {
                                                        ...b,
                                                        is_substitutable:
                                                          newValue,
                                                      }
                                                    : b
                                                )
                                            )
                                            await supabase
                                              .from('billofmaterials')
                                              .update({
                                                is_substitutable:
                                                  newValue,
                                              })
                                              .eq('bom_id', direct.bom_id)
                                          }}
                                        >
                                          <ArrowLeftRight className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        {direct.is_substitutable
                                          ? 'Substitutable — click to mark fixed'
                                          : 'Fixed — click to allow substitution'}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => startEdit(direct)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() =>
                                      deleteMutation.mutate(direct.bom_id)
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      }

                      return (
                        <>
                          {/* Direct rows */}
                          {directRows.map((it, idx) =>
                            renderBomRow(it, idx)
                          )}

                          {/* Linked sub-product groups */}
                          {Array.from(linkedGroups.entries()).map(
                            ([subProductId, items]) => {
                              const subProduct =
                                linkProductMap.get(subProductId)
                              const link = productLinks?.find(
                                (l) => l.sub_product_id === subProductId
                              )
                              const groupTotal = items.reduce(
                                (sum, it) => {
                                  const linkedPrice = (it as any)
                                    ?.suppliercomponents?.price
                                  const qty = Number(
                                    it.quantity_required || 0
                                  )
                                  const price =
                                    linkedPrice != null
                                      ? Number(linkedPrice)
                                      : 0
                                  return sum + price * qty
                                },
                                0
                              )

                              return (
                                <SubProductGroupHeader
                                  key={`group-${subProductId}`}
                                  productId={subProductId}
                                  productName={
                                    subProduct?.name || ''
                                  }
                                  productCode={
                                    subProduct?.internal_code ||
                                    String(subProductId)
                                  }
                                  itemCount={items.length}
                                  totalCost={groupTotal}
                                  scaleQty={
                                    link
                                      ? Number(link.scale)
                                      : 1
                                  }
                                  colSpan={colSpan}
                                >
                                  {items.map((it, childIdx) =>
                                    renderBomRow(
                                      it,
                                      1000 + subProductId * 100 + childIdx,
                                      true
                                    )
                                  )}
                                </SubProductGroupHeader>
                              )
                            }
                          )}
                        </>
                      )
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to product-bom.tsx

- [ ] **Step 4: Commit**

```bash
git add components/features/products/product-bom.tsx
git commit -m "feat: group linked BOM items under collapsible sub-product headers"
```

---

### Task 3: Add Grouping Logic to Labor Tab (product-bol.tsx)

**Files:**
- Modify: `components/features/products/product-bol.tsx`

Same pattern as Task 2 but for the labor table. The BOL unified rows already carry `_source` and `_sub_product_id`.

- [ ] **Step 1: Add import for SubProductGroupHeader**

At the top of `components/features/products/product-bol.tsx`, add:

```tsx
import { SubProductGroupHeader } from './SubProductGroupHeader'
```

- [ ] **Step 2: Replace flat row rendering with grouped rendering**

In `product-bol.tsx`, find the table body rendering (around line 542 where `unifiedRows.map` is called). Replace the flat `unifiedRows.map(...)` with partitioned rendering:

Partition `unifiedRows` into direct and linked groups, then render direct rows normally and linked groups under `SubProductGroupHeader`. For each linked group:
- Calculate group total cost by summing each row's cost (piece rate × qty for piecework, hourly rate × hours × qty for hourly)
- Get sub-product info from `linkProductMap`
- Render child rows with `border-l-2 border-l-teal-500/50` and `pl-7` on the first cell, with `text-muted-foreground` styling
- Child action cells show `—` instead of edit/delete buttons

The `colSpan` for the BOL table header is 9 (Category, Job, Pay Type, Time, Qty, Rate, Hours, Total Cost, Actions).

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to product-bol.tsx

- [ ] **Step 4: Commit**

```bash
git add components/features/products/product-bol.tsx
git commit -m "feat: group linked BOL items under collapsible sub-product headers"
```

---

### Task 4: Verify in Browser

**Files:** None (verification only)

- [ ] **Step 1: Navigate to the Apollo Visitors product costing page**

Open `http://localhost:3000/products/12?tab=costing` in Chrome via the Chrome MCP. This product has linked sub-products (QButton1.Bracket and QtBend).

- [ ] **Step 2: Check Materials tab**

Click the "Materials" sub-tab. Verify:
- Direct BOM items render as normal rows
- Linked items are grouped under teal-highlighted collapsible headers
- Each header shows SUB-PRODUCT badge, product name, item count, and total cost
- Headers are collapsed by default
- Clicking a header expands to show indented child rows with teal left border
- Child rows have muted text styling
- Clicking the sub-product name opens the sub-product's costing page in a new tab
- No console errors

- [ ] **Step 3: Check Labor tab**

Click the "Labor" sub-tab. Verify the same grouping behavior applies to linked labor items.

- [ ] **Step 4: Take a screenshot as proof**

Capture a screenshot showing the expanded sub-product group in the Materials tab.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: No new warnings or errors

- [ ] **Step 6: Commit any fixes**

If any lint or visual issues found, fix and commit.
