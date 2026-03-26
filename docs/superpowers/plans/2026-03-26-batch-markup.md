# Batch Markup Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a batch markup mode to the quote items table so users can select multiple items and update their markup percentage (or fixed amount) in one operation, with a preview of price changes and a confirmation dialog.

**Architecture:** All changes are in `QuoteItemsTable.tsx` (state, toolbar, column switching) plus a new `BatchMarkupConfirmDialog.tsx` for the confirmation modal. The batch mode replaces the Attachments and Actions columns with Markup, Profit, and Checkbox columns. Preview calculations are client-side only; persistence happens on confirm via existing `updateQuoteItemCluster` and `updateQuoteItem` functions.

**Tech Stack:** React, TypeScript, shadcn Dialog/Select/Input/Checkbox, existing quote DB functions from `lib/db/quotes.ts`, `formatCurrency` from `lib/quotes.ts`.

**Spec:** `docs/superpowers/specs/2026-03-26-batch-markup-design.md`

---

### Task 1: Add batch mode state and toolbar to QuoteItemsTable

**Files:**
- Modify: `components/features/quotes/QuoteItemsTable.tsx:1160-1223` (the main `QuoteItemsTable` return block)

This task adds the batch mode toggle state and renders a toolbar above the table when active.

- [ ] **Step 1: Add batch mode state variables**

At the top of the `QuoteItemsTable` function (after the existing state declarations around line 455), add:

```typescript
// Batch markup mode state
const [batchMode, setBatchMode] = useState(false);
const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
const [batchMarkupType, setBatchMarkupType] = useState<'percentage' | 'fixed'>('percentage');
const [batchMarkupValue, setBatchMarkupValue] = useState<string>('');
const [previewData, setPreviewData] = useState<Map<string, {
  oldPrice: number;
  newPrice: number;
  newTotal: number;
  oldMarkup: number;
  newMarkup: number;
  profit: number;
}> | null>(null);
const [showConfirmDialog, setShowConfirmDialog] = useState(false);
```

Add the import for `useState` if not already imported (it's imported via `React` already — use `React.useState` or add to the existing `import React from 'react'`). Also add `Checkbox` import:

```typescript
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

Check if `Select` is already imported — if so, skip that line. `Checkbox` is from shadcn — verify it exists:

```bash
ls components/ui/checkbox.tsx
```

If missing, install it:

```bash
pnpm dlx shadcn@latest add checkbox
```

- [ ] **Step 2: Compute eligible items list**

Below the batch state declarations, add a memo for eligible items (priced items with at least one cluster):

```typescript
const eligibleBatchItems = React.useMemo(() => {
  return items.filter(item => {
    const isPriced = !item.item_type || item.item_type === 'priced';
    const hasCluster = (item.quote_item_clusters || []).length > 0;
    return isPriced && hasCluster;
  });
}, [items]);
```

- [ ] **Step 3: Add helper to exit batch mode**

```typescript
const exitBatchMode = () => {
  setBatchMode(false);
  setSelectedItemIds(new Set());
  setBatchMarkupValue('');
  setBatchMarkupType('percentage');
  setPreviewData(null);
  setShowConfirmDialog(false);
};
```

- [ ] **Step 4: Add select-all toggle handler**

```typescript
const handleToggleSelectAll = (checked: boolean) => {
  if (checked) {
    setSelectedItemIds(new Set(eligibleBatchItems.map(item => item.id)));
  } else {
    setSelectedItemIds(new Set());
  }
  setPreviewData(null); // Clear preview when selection changes
};

const handleToggleItem = (itemId: string, checked: boolean) => {
  setSelectedItemIds(prev => {
    const next = new Set(prev);
    if (checked) next.add(itemId);
    else next.delete(itemId);
    return next;
  });
  setPreviewData(null); // Clear preview when selection changes
};
```

- [ ] **Step 5: Add Batch Markup button to toolbar**

In the toolbar div (around line 1162), add the Batch Markup button next to Add Item:

Replace:
```typescript
<div className="flex justify-between items-center">
  <div className="text-sm text-muted-foreground">
    {items.length} {items.length === 1 ? 'item' : 'items'}
  </div>
  <Button onClick={handleAddItem} size="sm" className="bg-primary hover:bg-primary/90">
    Add Item
  </Button>
</div>
```

With:
```typescript
<div className="flex justify-between items-center">
  <div className="text-sm text-muted-foreground">
    {items.length} {items.length === 1 ? 'item' : 'items'}
  </div>
  <div className="flex items-center gap-2">
    {!batchMode && (
      <Button
        onClick={() => setBatchMode(true)}
        size="sm"
        variant="outline"
        className="border-primary/50 text-primary hover:bg-primary/10"
        disabled={eligibleBatchItems.length === 0}
      >
        Batch Markup
      </Button>
    )}
    {!batchMode && (
      <Button onClick={handleAddItem} size="sm" className="bg-primary hover:bg-primary/90">
        Add Item
      </Button>
    )}
  </div>
</div>
```

- [ ] **Step 6: Add batch toolbar (shown when batch mode is active)**

Immediately after the toolbar div and before the table container div (the `<div className="rounded-lg border bg-card overflow-x-auto">`), add:

```typescript
{batchMode && (
  <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-sm flex-wrap">
    <label className="flex items-center gap-1.5 text-muted-foreground">
      <Checkbox
        checked={selectedItemIds.size === eligibleBatchItems.length && eligibleBatchItems.length > 0}
        onCheckedChange={(checked) => handleToggleSelectAll(!!checked)}
      />
      All
    </label>
    <span className="text-muted-foreground text-xs">
      {selectedItemIds.size} of {eligibleBatchItems.length} selected
    </span>
    <span className="border-l border-border h-4" />
    <Select
      value={batchMarkupType}
      onValueChange={(v) => {
        setBatchMarkupType(v as 'percentage' | 'fixed');
        setPreviewData(null);
      }}
    >
      <SelectTrigger className="w-[90px] h-7 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="percentage">%</SelectItem>
        <SelectItem value="fixed">R (fixed)</SelectItem>
      </SelectContent>
    </Select>
    <Input
      type="number"
      value={batchMarkupValue}
      onChange={(e) => {
        setBatchMarkupValue(e.target.value);
        setPreviewData(null);
      }}
      onFocus={(e) => e.target.select()}
      placeholder="0"
      className="w-20 h-7 text-xs"
    />
    <Button
      size="sm"
      className="h-7 text-xs"
      disabled={selectedItemIds.size === 0 || batchMarkupValue === ''}
      onClick={previewData ? () => setShowConfirmDialog(true) : handlePreview}
    >
      {previewData ? 'Apply' : 'Preview'}
    </Button>
    <Button
      size="sm"
      variant="ghost"
      className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
      onClick={exitBatchMode}
    >
      Cancel
    </Button>
  </div>
)}
```

Note: `handlePreview` will be defined in Task 2. For now, reference it — it'll be added before this compiles.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(quotes): add batch markup mode state and toolbar UI"
```

---

### Task 2: Preview calculation logic

**Files:**
- Modify: `components/features/quotes/QuoteItemsTable.tsx` (add `handlePreview` function)

- [ ] **Step 1: Add the preview calculation handler**

Add this after the `handleToggleItem` function:

```typescript
const handlePreview = () => {
  const preview = new Map<string, {
    oldPrice: number;
    newPrice: number;
    newTotal: number;
    oldMarkup: number;
    newMarkup: number;
    profit: number;
  }>();

  const markupValue = parseFloat(batchMarkupValue) || 0;

  for (const item of items) {
    if (!selectedItemIds.has(item.id)) continue;
    const cluster = (item.quote_item_clusters || [])[0];
    if (!cluster) continue;

    const subtotal = calculateClusterSubtotal(cluster);
    const oldMarkup = cluster.markup_percent;
    const markupAmount = batchMarkupType === 'percentage'
      ? subtotal * (markupValue / 100)
      : markupValue;
    const newUnitPrice = roundCurrencyValue(subtotal + markupAmount);
    const newTotal = roundCurrencyValue(item.qty * newUnitPrice);
    const profit = roundCurrencyValue(markupAmount);

    preview.set(item.id, {
      oldPrice: item.unit_price,
      newPrice: newUnitPrice,
      newTotal,
      oldMarkup,
      newMarkup: markupValue,
      profit,
    });
  }

  setPreviewData(preview);
};
```

This references the existing `calculateClusterSubtotal` and `roundCurrencyValue` helper functions already defined at the top of the file (lines 147-157).

- [ ] **Step 2: Add preview totals memo**

Below `handlePreview`, add a memo that computes the summary row data:

```typescript
const batchPreviewTotals = React.useMemo(() => {
  if (!previewData) return null;

  let oldTotal = 0;
  let newTotal = 0;
  let totalProfit = 0;

  for (const item of items) {
    const isPriced = !item.item_type || item.item_type === 'priced';
    if (!isPriced) continue;

    const preview = previewData.get(item.id);
    if (preview) {
      oldTotal += roundCurrencyValue(item.qty * item.unit_price);
      newTotal += preview.newTotal;
      totalProfit += preview.profit * item.qty;
    } else {
      // Unselected items contribute their current totals
      oldTotal += roundCurrencyValue(item.qty * item.unit_price);
      newTotal += roundCurrencyValue(item.qty * item.unit_price);
      const cluster = (item.quote_item_clusters || [])[0];
      if (cluster) {
        const subtotal = calculateClusterSubtotal(cluster);
        const markupAmount = subtotal * (cluster.markup_percent / 100);
        totalProfit += roundCurrencyValue(markupAmount) * item.qty;
      }
    }
  }

  return { oldTotal, newTotal, totalProfit };
}, [previewData, items]);
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(quotes): add batch markup preview calculation"
```

---

### Task 3: Modify table columns for batch mode

**Files:**
- Modify: `components/features/quotes/QuoteItemsTable.tsx:1173-1183` (table header)
- Modify: `components/features/quotes/QuoteItemsTable.tsx:325-381` (QuoteItemRow cells)

- [ ] **Step 1: Pass batch mode props to QuoteItemRow**

Update the `QuoteItemRow` props interface (around line 190) to add:

```typescript
batchMode?: boolean;
isSelected?: boolean;
onToggleSelect?: (checked: boolean) => void;
previewData?: {
  oldPrice: number;
  newPrice: number;
  newTotal: number;
  oldMarkup: number;
  newMarkup: number;
  profit: number;
} | null;
```

In the function signature destructuring (around line 222), add these new props:

```typescript
batchMode = false,
isSelected = false,
onToggleSelect,
previewData: itemPreview = null,
```

- [ ] **Step 2: Update table header for batch mode**

Replace the `<TableHeader>` block (lines 1173-1183):

```typescript
<TableHeader>
  <TableRow className="bg-muted/50">
    <TableHead className="w-20 text-center"></TableHead>
    <TableHead className="font-medium min-w-[250px]">Description</TableHead>
    <TableHead className="w-32 text-center font-medium">Qty</TableHead>
    <TableHead className="w-36 text-center font-medium">Unit Price</TableHead>
    <TableHead className="w-40 text-right font-medium">Total</TableHead>
    {batchMode ? (
      <>
        <TableHead className="w-16 text-center font-medium text-primary">Markup</TableHead>
        <TableHead className="w-28 text-right font-medium text-green-500">Profit</TableHead>
        <TableHead className="w-10 text-center">
          <Checkbox
            checked={selectedItemIds.size === eligibleBatchItems.length && eligibleBatchItems.length > 0}
            onCheckedChange={(checked) => handleToggleSelectAll(!!checked)}
          />
        </TableHead>
      </>
    ) : (
      <>
        <TableHead className="w-28 text-center font-medium">Attachments</TableHead>
        <TableHead className="w-40 text-center font-medium">Actions</TableHead>
      </>
    )}
  </TableRow>
</TableHeader>
```

- [ ] **Step 3: Pass batch props in the items map**

In the `<TableBody>` items map (around line 1186-1208), add the new props to `<QuoteItemRow>`:

```typescript
batchMode={batchMode}
isSelected={selectedItemIds.has(item.id)}
onToggleSelect={(checked) => handleToggleItem(item.id, checked)}
previewData={previewData?.get(item.id) ?? null}
```

- [ ] **Step 4: Update QuoteItemRow to render batch columns**

In `QuoteItemRow`, replace the Attachments cell (line 325-332) and Actions cell (line 333-381) with conditional rendering:

Replace:
```typescript
<TableCell>
  <QuoteItemAttachmentsCell
    quoteId={quoteId}
    itemId={item.id}
    version={attachmentsVersion}
    onItemAttachmentsChange={onItemAttachmentsChange}
  />
</TableCell>
<TableCell className="text-center">
  <div className="flex items-center justify-center gap-2">
    ...existing actions code...
  </div>
</TableCell>
```

With:
```typescript
{batchMode ? (
  <>
    <TableCell className="text-center">
      {isPriced ? (
        itemPreview ? (
          <span className="text-amber-500 text-xs font-medium">
            {itemPreview.oldMarkup}→{itemPreview.newMarkup}
            {batchMarkupType === 'percentage' ? '%' : ''}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">
            {((item.quote_item_clusters || [])[0]?.markup_percent ?? 0)}%
          </span>
        )
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </TableCell>
    <TableCell className="text-right">
      {isPriced ? (
        <span className="text-green-500 text-xs font-medium">
          {formatCurrency(
            itemPreview
              ? itemPreview.profit * item.qty
              : (() => {
                  const cluster = (item.quote_item_clusters || [])[0];
                  if (!cluster) return 0;
                  const subtotal = calculateClusterSubtotal(cluster);
                  return roundCurrencyValue(subtotal * (cluster.markup_percent / 100)) * item.qty;
                })()
          )}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </TableCell>
    <TableCell className="text-center">
      {isPriced && (item.quote_item_clusters || []).length > 0 ? (
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onToggleSelect?.(!!checked)}
        />
      ) : null}
    </TableCell>
  </>
) : (
  <>
    <TableCell>
      <QuoteItemAttachmentsCell
        quoteId={quoteId}
        itemId={item.id}
        version={attachmentsVersion}
        onItemAttachmentsChange={onItemAttachmentsChange}
      />
    </TableCell>
    <TableCell className="text-center">
      <div className="flex items-center justify-center gap-2">
        <Button variant="secondary" size="sm" className="px-3 py-1.5 relative" onClick={() => setDetailsOpen(true)}>
          Details
          {item.internal_notes && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-amber-500" title="Has internal notes" />
          )}
        </Button>
        {isPriced && (
          <Button
            variant="outline"
            size="sm"
            className="px-3 py-1.5"
            title="Cutlist Calculator"
            aria-label="Cutlist Calculator"
            asChild
          >
            <Link href={`/quotes/${quoteId}/cutlist/${item.id}`}>
              Cutlist
            </Link>
          </Button>
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          title="Duplicate item"
          aria-label="Duplicate item"
          onClick={() => onDuplicate(item.id)}
          disabled={isDuplicating}
        >
          {isDuplicating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="destructiveSoft"
          size="icon"
          className="h-8 w-8"
          title="Delete item"
          aria-label="Delete item"
          onClick={() => onDelete(item.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </TableCell>
  </>
)}
```

Note: `batchMarkupType` needs to be passed as a prop to `QuoteItemRow` as well. Add `batchMarkupType?: 'percentage' | 'fixed'` to the props interface and pass it from the parent:

```typescript
batchMarkupType={batchMarkupType}
```

And destructure it in the component: `batchMarkupType = 'percentage'`.

- [ ] **Step 5: Update Unit Price cell to show strikethrough when preview is active**

In `QuoteItemRow`, replace the Unit Price `<TableCell>` (line 315):

```typescript
<TableCell>
  {itemPreview ? (
    <div className="text-right">
      <div className="text-muted-foreground line-through text-[10px]">
        {formatCurrency(itemPreview.oldPrice)}
      </div>
      <div className="text-primary font-bold text-xs">
        {formatCurrency(itemPreview.newPrice)}
      </div>
    </div>
  ) : (
    <Input
      type="number"
      step="0.01"
      value={unitPrice}
      onChange={e => setUnitPrice(e.target.value)}
      onBlur={() => {
        const numPrice = Math.round((Number(unitPrice) || 0) * 100) / 100;
        if (numPrice !== item.unit_price) onUpdate(item.id, 'unit_price', numPrice);
        setUnitPrice(String(numPrice));
      }}
      onFocus={e => e.target.select()}
    />
  )}
</TableCell>
```

- [ ] **Step 6: Update Total cell for preview**

Replace the Total `<TableCell>` (line 316):

```typescript
<TableCell className="text-right font-medium">
  {itemPreview
    ? formatCurrency(itemPreview.newTotal)
    : formatCurrency((Number(qty) || 0) * (Number(unitPrice) || 0))
  }
</TableCell>
```

- [ ] **Step 7: Add preview totals footer row**

After the `</TableBody>` closing tag (before `</Table>`), add:

```typescript
{batchMode && batchPreviewTotals && (
  <tfoot>
    <tr className="border-t border-border">
      <td colSpan={5} className="text-right text-xs text-muted-foreground py-2 pr-2">
        <span className="line-through mr-2">{formatCurrency(batchPreviewTotals.oldTotal)}</span>
        <span className="text-primary font-bold">{formatCurrency(batchPreviewTotals.newTotal)}</span>
      </td>
      <td className="text-center text-xs text-muted-foreground py-2"></td>
      <td className="text-right text-xs text-green-500 font-medium py-2 pr-2">
        {formatCurrency(batchPreviewTotals.totalProfit)}
      </td>
      <td></td>
    </tr>
  </tfoot>
)}
```

Note: Pass `batchPreviewTotals` as accessible from the parent component. Since it's a memo on the parent and the `tfoot` is rendered in the parent's return, it's already in scope.

- [ ] **Step 8: Dim unselected rows in batch mode**

In `QuoteItemRow`, update the `<TableRow>` className (line 257):

```typescript
<TableRow
  key={item.id}
  ref={rowRef}
  className={`
    ${isHeading ? 'bg-muted/30' : ''}
    ${batchMode && isPriced && !isSelected ? 'opacity-40' : ''}
  `.trim() || undefined}
>
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(quotes): render batch markup columns with preview in table"
```

---

### Task 4: Confirmation dialog and apply logic

**Files:**
- Create: `components/features/quotes/BatchMarkupConfirmDialog.tsx`
- Modify: `components/features/quotes/QuoteItemsTable.tsx` (add apply handler and render dialog)

- [ ] **Step 1: Create the confirmation dialog component**

```typescript
// components/features/quotes/BatchMarkupConfirmDialog.tsx
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/quotes';

interface BatchMarkupConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  selectedCount: number;
  markupValue: number;
  markupType: 'percentage' | 'fixed';
  oldTotal: number;
  newTotal: number;
  isApplying: boolean;
}

export default function BatchMarkupConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  selectedCount,
  markupValue,
  markupType,
  oldTotal,
  newTotal,
  isApplying,
}: BatchMarkupConfirmDialogProps) {
  const difference = newTotal - oldTotal;
  const markupLabel = markupType === 'percentage'
    ? `${markupValue}%`
    : `${formatCurrency(markupValue)} fixed`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Apply Batch Markup?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Updating <span className="text-foreground font-medium">{selectedCount} item{selectedCount !== 1 ? 's' : ''}</span> to{' '}
            <span className="text-primary font-medium">{markupLabel}</span> markup
          </p>
          <div className="space-y-1.5 pt-2 border-t border-border">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Old quote total</span>
              <span className="text-muted-foreground line-through">{formatCurrency(oldTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">New quote total</span>
              <span className="text-primary font-bold">{formatCurrency(newTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Difference</span>
              <span className={difference < 0 ? 'text-destructive font-medium' : 'text-green-500 font-medium'}>
                {difference < 0 ? '-' : '+'}{formatCurrency(Math.abs(difference))}
              </span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isApplying}>
            {isApplying ? 'Applying...' : 'Apply Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add apply handler to QuoteItemsTable**

Add this function after `handlePreview` in `QuoteItemsTable`:

```typescript
const [isApplyingBatch, setIsApplyingBatch] = useState(false);

const handleApplyBatchMarkup = async () => {
  if (!previewData) return;
  setIsApplyingBatch(true);

  try {
    const markupValue = parseFloat(batchMarkupValue) || 0;
    const updates: Promise<unknown>[] = [];

    for (const [itemId, preview] of previewData.entries()) {
      const item = items.find(i => i.id === itemId);
      if (!item) continue;
      const cluster = (item.quote_item_clusters || [])[0];
      if (!cluster) continue;

      updates.push(
        updateQuoteItemCluster(cluster.id, { markup_percent: markupValue }),
        updateQuoteItem(itemId, {
          unit_price: preview.newPrice,
          total: preview.newTotal,
        }),
      );
    }

    await Promise.all(updates);

    // Optimistic UI update
    const updatedItems = items.map(item => {
      const preview = previewData.get(item.id);
      if (!preview) return item;
      const cluster = (item.quote_item_clusters || [])[0];
      return {
        ...item,
        unit_price: preview.newPrice,
        total: preview.newTotal,
        quote_item_clusters: item.quote_item_clusters?.map(c =>
          c.id === cluster?.id
            ? { ...c, markup_percent: parseFloat(batchMarkupValue) || 0 }
            : c
        ),
      };
    });

    onItemsChange(updatedItems);
    toast({
      title: 'Markup updated',
      description: `Updated markup on ${previewData.size} item${previewData.size !== 1 ? 's' : ''}.`,
    });
    exitBatchMode();
  } catch (error) {
    console.error('Batch markup error:', error);
    toast({
      title: 'Error',
      description: 'Failed to apply batch markup. Please try again.',
      variant: 'destructive',
    });
  } finally {
    setIsApplyingBatch(false);
  }
};
```

- [ ] **Step 3: Import and render the confirmation dialog**

At the top of `QuoteItemsTable.tsx`, add:

```typescript
import BatchMarkupConfirmDialog from './BatchMarkupConfirmDialog';
```

At the end of the return block, just before the closing `</div>` of the component (after `<AddQuoteItemDialog>`), add:

```typescript
<BatchMarkupConfirmDialog
  open={showConfirmDialog}
  onOpenChange={setShowConfirmDialog}
  onConfirm={handleApplyBatchMarkup}
  selectedCount={previewData?.size ?? 0}
  markupValue={parseFloat(batchMarkupValue) || 0}
  markupType={batchMarkupType}
  oldTotal={batchPreviewTotals?.oldTotal ?? 0}
  newTotal={batchPreviewTotals?.newTotal ?? 0}
  isApplying={isApplyingBatch}
/>
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(quotes): add batch markup confirmation dialog and apply logic"
```

---

### Task 5: Lint, type-check, and verify in browser

**Files:**
- All modified files

- [ ] **Step 1: Run linter**

```bash
npm run lint
```

Fix any lint errors.

- [ ] **Step 2: Run type-check**

```bash
npx tsc --noEmit
```

Fix any type errors. Common issues to watch for:
- `calculateClusterSubtotal` and `roundCurrencyValue` are file-scoped functions — they're accessible from `QuoteItemRow` since it's in the same file
- `formatCurrency` needs to be imported in `BatchMarkupConfirmDialog` from `@/lib/quotes`
- The `Checkbox` component might use `CheckedState` type for `onCheckedChange`

- [ ] **Step 3: Verify in Chrome**

Navigate to a quote with multiple priced items:
1. Open the quote detail page
2. Click **Batch Markup** button
3. Verify: Attachments + Actions columns are replaced by Markup, Profit, Checkbox
4. Select items using checkboxes
5. Enter a markup value (e.g. 30%)
6. Click **Preview** — verify strikethrough prices, new prices, profit amounts
7. Click **Apply** — verify confirmation dialog shows correct totals
8. Confirm — verify prices update and batch mode exits
9. Cancel flow — verify no changes are saved

Take a screenshot of the batch mode table as proof.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(quotes): lint and type-check fixes for batch markup"
```

---

### Task 6: Run /simplify

Since this change modifies more than 3 files, run the `/simplify` skill to check for code quality issues, duplication, and cleanup opportunities before finalizing.

- [ ] **Step 1: Run /simplify**

Invoke the `simplify` skill to review all changed files.

- [ ] **Step 2: Apply any suggestions and commit**

```bash
git add -A
git commit -m "refactor(quotes): simplify batch markup per review"
```
