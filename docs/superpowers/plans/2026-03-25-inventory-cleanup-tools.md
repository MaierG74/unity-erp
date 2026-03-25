# Inventory Cleanup Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build low-click inventory cleanup tools on the Transactions Explorer page — quick adjust, stock transfer, batch adjust, printable count sheets, and component disable.

**Architecture:** All features are UI additions on the existing Transactions Explorer (`components/features/inventory/transactions/`). One new Postgres RPC for stock transfers. The existing `StockAdjustmentDialog` is extended with Transfer mode and auto-advance. New `BatchAdjustMode` and `CountSheetPrintView` components. One migration adds `transfer_ref` column, TRANSFER transaction type, `transfer_component_stock` RPC, and `is_active` on components.

**Tech Stack:** Next.js, React, Supabase JS v2, Postgres RPC, shadcn/ui components, `react-to-print`

**Spec:** `docs/superpowers/specs/2026-03-25-inventory-cleanup-tools-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `components/features/inventory/transactions/TransactionsGroupedTable.tsx` | Add Adjust button, remove in/out totals, kebab menu, batch mode support |
| Modify | `components/features/inventory/transactions/TransactionsExplorer.tsx` | Dialog state management, batch state, count sheet data, component list for auto-advance |
| Modify | `components/features/inventory/transactions/TransactionsToolbar.tsx` | Print dropdown, Batch Adjust button, batch toolbar |
| Modify | `components/features/inventory/component-detail/StockAdjustmentDialog.tsx` | Transfer mode, auto-advance (Save & Next), component picker |
| Create | `components/features/inventory/transactions/CountSheetPrintView.tsx` | Printable stock count sheet layout |
| Create | `components/features/inventory/transactions/BatchAdjustMode.tsx` | Inline batch editing UI + confirmation dialog |
| Create | `supabase/migrations/20260326000000_inventory_cleanup_tools.sql` | TRANSFER type, transfer_ref column, transfer RPC, is_active column |

---

### Task 1: Database Migration — TRANSFER type, transfer_ref, transfer RPC, is_active

**Files:**
- Create: `supabase/migrations/20260326000000_inventory_cleanup_tools.sql`

This single migration adds all the backend pieces needed across Features 2, 5, and 6.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 1. Add TRANSFER transaction type
INSERT INTO public.transaction_types (type_name)
SELECT 'TRANSFER'
WHERE NOT EXISTS (
  SELECT 1 FROM public.transaction_types WHERE type_name = 'TRANSFER'
);

-- 2. Add transfer_ref column to inventory_transactions (nullable, audit-only)
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS transfer_ref uuid NULL;

-- 3. Add is_active column to components
ALTER TABLE public.components
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 4. Recreate the enriched view to include new columns
CREATE OR REPLACE VIEW public.inventory_transactions_enriched
WITH (security_invoker = true) AS
SELECT
  it.transaction_id,
  it.component_id,
  it.quantity,
  it.transaction_date,
  it.order_id,
  it.purchase_order_id,
  it.user_id,
  it.reason,
  it.org_id,
  it.transaction_type_id,
  it.transfer_ref,
  c.internal_code  AS component_code,
  c.description    AS component_description,
  c.category_id,
  c.is_active      AS component_is_active,
  cc.categoryname  AS category_name,
  tt.type_name     AS transaction_type_name,
  po.q_number      AS po_number,
  po.supplier_id,
  s.name           AS supplier_name,
  o.order_number
FROM public.inventory_transactions it
LEFT JOIN public.components        c  ON c.component_id        = it.component_id
LEFT JOIN public.component_categories cc ON cc.cat_id           = c.category_id
LEFT JOIN public.transaction_types tt ON tt.transaction_type_id = it.transaction_type_id
LEFT JOIN public.purchase_orders   po ON po.purchase_order_id   = it.purchase_order_id
LEFT JOIN public.suppliers         s  ON s.supplier_id          = po.supplier_id
LEFT JOIN public.orders            o  ON o.order_id             = it.order_id;

GRANT SELECT ON public.inventory_transactions_enriched TO authenticated;

-- 5. Transfer stock RPC
-- NOTE: org_id is derived from auth.uid() via organization_members, NOT passed as a parameter.
-- This matches the pattern used by other RPCs in the codebase (acknowledge_work_pool_exception, etc.)
CREATE OR REPLACE FUNCTION public.transfer_component_stock(
  p_from_component_id integer,
  p_to_component_id integer,
  p_quantity integer,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_transfer_ref uuid := gen_random_uuid();
  v_transfer_type_id integer;
  v_from_txn_id integer;
  v_to_txn_id integer;
  v_full_reason text;
  v_org_id uuid;
BEGIN
  -- Derive org_id from the source component (RLS already ensures the user can see it)
  SELECT org_id INTO v_org_id FROM public.components WHERE component_id = p_from_component_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Source component not found';
  END IF;

  -- Validate caller is an active member of this org
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid() AND org_id = v_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  -- Validate destination component belongs to same org
  IF NOT EXISTS (SELECT 1 FROM public.components WHERE component_id = p_to_component_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'Destination component not found in organization';
  END IF;

  -- Get TRANSFER type ID
  SELECT transaction_type_id INTO v_transfer_type_id
  FROM public.transaction_types WHERE type_name = 'TRANSFER';
  IF v_transfer_type_id IS NULL THEN
    RAISE EXCEPTION 'TRANSFER transaction type not found';
  END IF;

  -- Build reason string
  v_full_reason := p_reason || CASE WHEN p_notes IS NOT NULL AND p_notes != '' THEN ': ' || p_notes ELSE '' END;

  -- Insert negative transaction on source
  INSERT INTO public.inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date,
    user_id, reason, org_id, transfer_ref
  ) VALUES (
    p_from_component_id, -p_quantity, v_transfer_type_id, now(),
    auth.uid(), v_full_reason, v_org_id, v_transfer_ref
  ) RETURNING transaction_id INTO v_from_txn_id;

  -- Insert positive transaction on destination
  INSERT INTO public.inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date,
    user_id, reason, org_id, transfer_ref
  ) VALUES (
    p_to_component_id, p_quantity, v_transfer_type_id, now(),
    auth.uid(), v_full_reason, v_org_id, v_transfer_ref
  ) RETURNING transaction_id INTO v_to_txn_id;

  -- Update source inventory (decrement)
  INSERT INTO public.inventory (component_id, quantity_on_hand, reorder_level)
  VALUES (p_from_component_id, -p_quantity, 0)
  ON CONFLICT (component_id) DO UPDATE
  SET quantity_on_hand = public.inventory.quantity_on_hand - p_quantity;

  -- Update destination inventory (increment)
  INSERT INTO public.inventory (component_id, quantity_on_hand, reorder_level)
  VALUES (p_to_component_id, p_quantity, 0)
  ON CONFLICT (component_id) DO UPDATE
  SET quantity_on_hand = public.inventory.quantity_on_hand + p_quantity;

  RETURN jsonb_build_object(
    'transfer_ref', v_transfer_ref,
    'from_transaction_id', v_from_txn_id,
    'to_transaction_id', v_to_txn_id,
    'quantity', p_quantity
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_component_stock TO authenticated;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Run: `mcp__supabase__apply_migration` with name `inventory_cleanup_tools` and the SQL above.

- [ ] **Step 3: Verify**

```sql
-- Check TRANSFER type exists
SELECT * FROM transaction_types WHERE type_name = 'TRANSFER';
-- Check transfer_ref column exists
SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory_transactions' AND column_name = 'transfer_ref';
-- Check is_active column exists
SELECT column_name FROM information_schema.columns WHERE table_name = 'components' AND column_name = 'is_active';
-- Check RPC exists
SELECT routine_name FROM information_schema.routines WHERE routine_name = 'transfer_component_stock';
```

- [ ] **Step 4: Save migration file locally and commit**

```bash
git add supabase/migrations/20260326000000_inventory_cleanup_tools.sql
git commit -m "feat: migration for inventory cleanup tools (TRANSFER type, transfer_ref, is_active, RPC)"
```

---

### Task 2: Remove In/Out Totals from Component Group Headers (Feature 3)

**Files:**
- Modify: `components/features/inventory/transactions/TransactionsGroupedTable.tsx`

The simplest change — remove the `<MovementBadges>` from component group headers (lines 384-385) and from sub-group divider rows (line 509).

- [ ] **Step 1: Remove MovementBadges from the main group header**

In `TransactionsGroupedTable.tsx`, find the `<div className="flex items-center gap-4 text-sm shrink-0">` block (around line 384). Remove the `<MovementBadges>` line:

```tsx
// REMOVE this line:
<MovementBadges sumIn={group.sumIn} sumOut={group.sumOut} />
```

- [ ] **Step 2: Remove MovementBadges from sub-group divider rows**

In the `SubGroupRows` component, find the `<MovementBadges>` usage (around line 509). Remove it:

```tsx
// REMOVE this line:
<MovementBadges sumIn={sub.sumIn} sumOut={sub.sumOut} className="text-xs" />
```

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:3001/inventory?tab=transactions`, select "By Component" grouping. Confirm:
- Component headers no longer show green/red in/out totals
- Stock, On Order, Reserved figures still display
- Toolbar summary still shows overall in/out totals

- [ ] **Step 4: Commit**

```bash
git add components/features/inventory/transactions/TransactionsGroupedTable.tsx
git commit -m "feat: remove in/out totals from component group headers"
```

---

### Task 3: Quick Adjust Button + Auto-Advance (Feature 1)

**Files:**
- Modify: `components/features/inventory/transactions/TransactionsGroupedTable.tsx` — add Adjust button, accept `onAdjust` callback
- Modify: `components/features/inventory/transactions/TransactionsExplorer.tsx` — manage dialog state, ordered component list, invalidation
- Modify: `components/features/inventory/component-detail/StockAdjustmentDialog.tsx` — add `onSaveAndNext` prop, reset on componentId change

- [ ] **Step 1: Add `onAdjust` callback to TransactionsGroupedTable props**

In `TransactionsGroupedTable.tsx`, extend the `Props` type:

```typescript
type Props = {
  transactions: EnrichedTransaction[];
  groupBy: GroupByMode;
  stockSummaryMap?: Map<number, ComponentStockSummary>;
  onAdjust?: (componentId: number, componentName: string, currentStock: number) => void;
};
```

Update the function signature to destructure `onAdjust`.

- [ ] **Step 2: Add Adjust button to the component group header**

Inside the component group header (around line 384), add a Button before the stock summary. The button must call `e.stopPropagation()` to prevent toggling the group:

```tsx
{isComponentGroup && onAdjust && group.stockSummary && (
  <Button
    variant="outline"
    size="sm"
    className="h-6 text-xs px-2"
    onClick={(e) => {
      e.stopPropagation();
      onAdjust(
        Number(group.key),
        group.label,
        group.stockSummary!.quantityOnHand
      );
    }}
  >
    Adjust
  </Button>
)}
```

- [ ] **Step 3: Wire up dialog state in TransactionsExplorer**

In `TransactionsExplorer.tsx`:

1. Import `StockAdjustmentDialog`
2. Add state for the dialog target:

```typescript
const [adjustTarget, setAdjustTarget] = useState<{
  componentId: number;
  componentName: string;
  currentStock: number;
} | null>(null);
```

3. Compute an ordered list of component groups for auto-advance:

```typescript
const orderedComponents = useMemo(() => {
  if (config.groupBy !== 'component') return [];
  const seen = new Map<number, { name: string; stock: number }>();
  transactions.forEach((t) => {
    if (!seen.has(t.component_id)) {
      seen.set(t.component_id, {
        name: t.component?.internal_code || 'Unknown',
        stock: stockSummaryMap?.get(t.component_id)?.quantityOnHand ?? 0,
      });
    }
  });
  return Array.from(seen.entries())
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([id, info]) => ({ componentId: id, ...info }));
}, [transactions, config.groupBy, stockSummaryMap]);
```

4. Handle the adjust and next callbacks:

```typescript
const handleAdjust = useCallback((componentId: number, componentName: string, currentStock: number) => {
  setAdjustTarget({ componentId, componentName, currentStock });
}, []);

const handleAdjustSuccess = useCallback(() => {
  queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions', 'explorer'] });
  queryClient.invalidateQueries({ queryKey: ['component-stock-summary'] });
}, [queryClient]);

const handleSaveAndNext = useCallback(() => {
  handleAdjustSuccess();
  if (!adjustTarget) return;
  const idx = orderedComponents.findIndex((c) => c.componentId === adjustTarget.componentId);
  const next = orderedComponents[idx + 1];
  if (next) {
    setAdjustTarget({ componentId: next.componentId, componentName: next.name, currentStock: next.stock });
  } else {
    setAdjustTarget(null);
    toast.info('All components adjusted');
  }
}, [adjustTarget, orderedComponents, handleAdjustSuccess]);
```

5. Pass `onAdjust` to `TransactionsGroupedTable`:

```tsx
<TransactionsGroupedTable
  transactions={transactions}
  groupBy={config.groupBy}
  stockSummaryMap={stockSummaryMap}
  onAdjust={handleAdjust}
/>
```

6. Render the dialog:

```tsx
{adjustTarget && (
  <StockAdjustmentDialog
    open={!!adjustTarget}
    onOpenChange={(open) => { if (!open) setAdjustTarget(null); }}
    componentId={adjustTarget.componentId}
    componentName={adjustTarget.componentName}
    currentStock={adjustTarget.currentStock}
    onSuccess={handleAdjustSuccess}
    onSaveAndNext={orderedComponents.length > 1 ? handleSaveAndNext : undefined}
  />
)}
```

- [ ] **Step 4: Extend StockAdjustmentDialog with onSuccess and onSaveAndNext**

In `StockAdjustmentDialog.tsx`:

1. Add to props:

```typescript
type StockAdjustmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: number;
  componentName: string;
  currentStock: number;
  onSuccess?: () => void;
  onSaveAndNext?: () => void;
};
```

2. In the `onSuccess` callback of the mutation, call `props.onSuccess?.()` in addition to existing invalidation.

3. Add a `useEffect` to reset form when `componentId` changes (for auto-advance). Memoize `resetForm` first to avoid stale closure issues:

```typescript
const resetForm = useCallback(() => {
  setAdjustmentType('set');
  setQuantity('');
  setReason('');
  setNotes('');
}, []);

// Reset when componentId changes (auto-advance swaps props while keeping dialog open)
useEffect(() => {
  resetForm();
}, [componentId, resetForm]);
```

Remove the existing non-memoized `resetForm` function declaration.

4. In the `DialogFooter`, add a "Save & Next" button when `onSaveAndNext` is provided:

```tsx
<DialogFooter>
  <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={adjustmentMutation.isPending}>
    Cancel
  </Button>
  {onSaveAndNext && (
    <Button
      type="button"
      variant="secondary"
      disabled={!isValid || adjustmentMutation.isPending}
      onClick={(e) => {
        e.preventDefault();
        if (!isValid) return;
        adjustmentMutation.mutate(undefined, {
          onSuccess: () => {
            toast.success(`${componentName} adjusted`);
            onSaveAndNext();
          },
        });
      }}
    >
      Save & Next
    </Button>
  )}
  <Button type="submit" disabled={!isValid || adjustmentMutation.isPending}>
    {adjustmentMutation.isPending ? (
      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Recording...</>
    ) : (
      'Record Adjustment'
    )}
  </Button>
</DialogFooter>
```

- [ ] **Step 5: Verify in browser**

- Click "Adjust" on a component group row — dialog opens pre-filled
- Submit an adjustment — stock updates, dialog closes
- Click "Adjust" again → use "Save & Next" — dialog stays open with next component
- At the last component, "Save & Next" closes and shows toast

- [ ] **Step 6: Commit**

```bash
git add components/features/inventory/transactions/ components/features/inventory/component-detail/StockAdjustmentDialog.tsx
git commit -m "feat: quick adjust button on component rows with auto-advance"
```

---

### Task 4: Stock Transfer Mode (Feature 2)

**Files:**
- Modify: `components/features/inventory/component-detail/StockAdjustmentDialog.tsx` — add Transfer as 4th adjustment type

- [ ] **Step 1: Add Transfer mode to adjustment type state**

Change the type from `'set' | 'add' | 'subtract'` to `'set' | 'add' | 'subtract' | 'transfer'`.

Add state for transfer:

```typescript
const [transferToId, setTransferToId] = useState<number | null>(null);
const [transferToName, setTransferToName] = useState('');
const [allowNegative, setAllowNegative] = useState(false);
```

Reset these in `resetForm()`.

- [ ] **Step 2: Add Transfer button to the adjustment type grid**

Change the grid from `grid-cols-3` to `grid-cols-4` and add:

```tsx
<Button
  type="button"
  variant={adjustmentType === 'transfer' ? 'default' : 'outline'}
  className="w-full"
  onClick={() => setAdjustmentType('transfer')}
>
  <ArrowRightLeft className="h-4 w-4 mr-1" />
  Transfer
</Button>
```

Import `ArrowRightLeft` from `lucide-react`.

- [ ] **Step 3: Render Transfer-specific fields**

When `adjustmentType === 'transfer'`, replace the quantity input section with:

```tsx
{adjustmentType === 'transfer' ? (
  <div className="space-y-3">
    <div className="space-y-2">
      <Label>Transfer To</Label>
      {/* Component search picker — use a simple Combobox or the existing component search pattern */}
      <ComponentTransferPicker
        value={transferToId}
        onChange={(id, name) => { setTransferToId(id); setTransferToName(name); }}
        excludeId={componentId}
      />
    </div>
    <div className="space-y-2">
      <Label>Quantity to Transfer</Label>
      <Input
        type="number"
        min="1"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="Enter quantity"
        className="text-lg"
      />
    </div>
    {numericQuantity > currentStock && !allowNegative && (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>Insufficient stock (current: {currentStock})</span>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={allowNegative} onChange={(e) => setAllowNegative(e.target.checked)} />
            Override — allow negative
          </label>
        </AlertDescription>
      </Alert>
    )}
    {transferToId && numericQuantity > 0 && (
      <p className="text-sm text-muted-foreground">
        Transfer {numericQuantity} units: {componentName} → {transferToName}
      </p>
    )}
  </div>
) : (
  /* existing quantity input */
)}
```

- [ ] **Step 4: Create ComponentTransferPicker**

A simple inline component (can live in the same file or a small separate file). It queries `components` and renders a searchable select:

```typescript
function ComponentTransferPicker({ value, onChange, excludeId }: {
  value: number | null;
  onChange: (id: number | null, name: string) => void;
  excludeId: number;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data: components = [] } = useQuery({
    queryKey: ['components-picker', debouncedSearch],
    queryFn: async () => {
      let q = supabase.from('components').select('component_id, internal_code, description').neq('component_id', excludeId).order('internal_code').limit(20);
      if (debouncedSearch) {
        q = q.or(`internal_code.ilike.%${debouncedSearch}%,description.ilike.%${debouncedSearch}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: true,
  });

  // Render as a Popover with search input and list
  // Use the Command component (shadcn) or a simple filtered list
}
```

The exact UI depends on whether there's an existing component picker pattern in the codebase. Check `ComponentSearchModal.tsx` or `ComponentPickerDialog.tsx` for the pattern to follow. The key is: searchable, shows code + description, single-select.

- [ ] **Step 5: Handle Transfer submission**

In the mutation function, add a branch for transfer:

```typescript
if (adjustmentType === 'transfer') {
  if (!transferToId) throw new Error('No destination component selected');
  // org_id is derived from auth.uid() inside the RPC — no need to pass it
  const { data, error } = await supabase.rpc('transfer_component_stock', {
    p_from_component_id: componentId,
    p_to_component_id: transferToId,
    p_quantity: numericQuantity,
    p_reason: selectedReason?.label || 'Transfer',
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
}
```

Update the `isValid` check to also validate transfer state:

```typescript
const isValid = adjustmentType === 'transfer'
  ? !!transferToId && numericQuantity > 0 && !!reason && (numericQuantity <= currentStock || allowNegative)
  : reason && adjustmentQuantity !== 0 && (reason !== 'other' || notes.trim());
```

- [ ] **Step 6: Verify in browser**

- Open Adjust dialog → click Transfer
- Search for a destination component
- Enter quantity → see summary line
- Try quantity > current stock → see warning + override checkbox
- Submit → verify two transactions appear (one negative, one positive)
- Verify both components' stock updated

- [ ] **Step 7: Commit**

```bash
git add components/features/inventory/component-detail/
git commit -m "feat: stock transfer mode in adjustment dialog"
```

---

### Task 5: Printable Stock Count Sheet (Feature 4)

**Files:**
- Create: `components/features/inventory/transactions/CountSheetPrintView.tsx`
- Modify: `components/features/inventory/transactions/TransactionsToolbar.tsx` — Print dropdown
- Modify: `components/features/inventory/transactions/TransactionsExplorer.tsx` — pass data + ref

- [ ] **Step 1: Create CountSheetPrintView**

A print-only component that renders a clean stock count table. Similar to `PrintView.tsx` in structure.

```tsx
'use client';

import { forwardRef } from 'react';
import { format } from 'date-fns';
import type { ComponentStockSummary } from '@/types/transaction-views';
import type { ViewConfig } from '@/types/transaction-views';

type CountSheetComponent = {
  componentId: number;
  code: string;
  description: string;
  category: string;
  currentStock: number;
  onOrder: number;
};

type Props = {
  components: CountSheetComponent[];
  onOrderComponents?: CountSheetComponent[];
  config: ViewConfig;
  dateRange: { from: Date; to: Date };
};

export const CountSheetPrintView = forwardRef<HTMLDivElement, Props>(
  ({ components, onOrderComponents, config, dateRange }, ref) => {
    return (
      <div
        ref={ref}
        className="hidden print:block"
        style={{ fontFamily: 'Inter, system-ui, sans-serif', fontSize: '11px', color: '#000', background: '#fff', padding: '20px' }}
      >
        {/* Header */}
        <div style={{ marginBottom: '16px', borderBottom: '2px solid #333', paddingBottom: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Stock Count Sheet</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: '10px' }}>
            {format(dateRange.from, 'MMM dd, yyyy')} — {format(dateRange.to, 'MMM dd, yyyy')}
            {' | '}Printed: {format(new Date(), 'MMM dd, yyyy HH:mm')}
          </p>
        </div>

        {/* Main count table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 'bold' }}>Code</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 'bold' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 'bold' }}>Category</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 'bold', width: '80px' }}>System Stock</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 'bold', width: '100px', borderBottom: '2px solid #333' }}>Counted</th>
              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 'bold', width: '80px' }}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.componentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '5px 8px', fontWeight: 600 }}>{c.code}</td>
                <td style={{ padding: '5px 8px' }}>{c.description}</td>
                <td style={{ padding: '5px 8px', color: '#666' }}>{c.category}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 600 }}>{c.currentStock}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', borderLeft: '1px solid #d1d5db', borderRight: '1px solid #d1d5db' }}>
                  {/* Blank for handwriting */}
                </td>
                <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                  {/* Blank for handwriting */}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* On-Order Section */}
        {onOrderComponents && onOrderComponents.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #999', paddingBottom: '4px' }}>
              On Order — Not Yet Received
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Description</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>Category</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', width: '80px' }}>On Order</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', width: '100px' }}>Counted</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', width: '80px' }}>Difference</th>
                </tr>
              </thead>
              <tbody>
                {onOrderComponents.map((c) => (
                  <tr key={c.componentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '5px 8px', fontWeight: 600 }}>{c.code}</td>
                    <td style={{ padding: '5px 8px' }}>{c.description}</td>
                    <td style={{ padding: '5px 8px', color: '#666' }}>{c.category}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#3b82f6', fontWeight: 600 }}>{c.onOrder}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', borderLeft: '1px solid #d1d5db', borderRight: '1px solid #d1d5db' }}></td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '40px', borderTop: '1px solid #999', paddingTop: '12px', display: 'flex', gap: '40px', fontSize: '11px' }}>
          <span>Counted by: _______________________________</span>
          <span>Date: _______________</span>
          <span>Signature: _______________________________</span>
        </div>
      </div>
    );
  }
);

CountSheetPrintView.displayName = 'CountSheetPrintView';
```

- [ ] **Step 2: Split Print button into dropdown in TransactionsToolbar**

Replace the Print button with a `DropdownMenu` (from shadcn):

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// Replace the Print button:
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" className="h-9">
      <Printer className="h-4 w-4 mr-1.5" />
      Print
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => handlePrint()}>
      Print Transactions
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => onPrintCountSheet?.()}>
      Print Count Sheet
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Add `onPrintCountSheet?: () => void` to the toolbar Props.

- [ ] **Step 3: Wire up count sheet data in TransactionsExplorer**

In `TransactionsExplorer.tsx`:

1. Add a ref for the count sheet: `const countSheetRef = useRef<HTMLDivElement>(null);`

2. **Fire a dedicated query when "Print Count Sheet" is clicked** — do NOT rely on the paginated transaction data. The count sheet needs ALL components matching the filters, not just those with transactions in the current date range.

```typescript
const [countSheetData, setCountSheetData] = useState<{ components: CountSheetComponent[]; onOrder: CountSheetComponent[] } | null>(null);

const fetchCountSheetData = useCallback(async () => {
  // Query all distinct components from transactions matching current filters
  // This uses the enriched view with all server-side filters EXCEPT date range
  // so we get every component the org has, filtered by category/supplier/search
  let q = supabase
    .from('components')
    .select('component_id, internal_code, description, category_id, component_categories(categoryname), inventory(quantity_on_hand)')
    .eq('is_active', true)
    .order('internal_code');

  // Apply active category filter if set
  if (config.filters.categoryId && config.filters.categoryId !== 'all') {
    q = q.eq('category_id', Number(config.filters.categoryId));
  }
  // Apply search filter if set
  if (config.filters.search?.trim()) {
    q = q.or(`internal_code.ilike.%${config.filters.search}%,description.ilike.%${config.filters.search}%`);
  }

  const { data, error } = await q;
  if (error) { toast.error('Failed to load count sheet data'); return; }

  const components: CountSheetComponent[] = (data || []).map((c: any) => ({
    componentId: c.component_id,
    code: c.internal_code || '',
    description: c.description || '',
    category: c.component_categories?.categoryname || '',
    currentStock: c.inventory?.[0]?.quantity_on_hand ?? 0,
    onOrder: 0, // filled below if applicable
  }));

  // TODO: Fetch on-order components separately using the supplier_orders pattern from use-component-stock-summary.ts
  // For now, pass empty array — can be enhanced in a follow-up

  setCountSheetData({ components, onOrder: [] });
}, [config.filters]);

// Print after data loads
useEffect(() => {
  if (countSheetData) {
    handlePrintCountSheetNow();
    setCountSheetData(null);
  }
}, [countSheetData]);

const countSheetRef = useRef<HTMLDivElement>(null);
const handlePrintCountSheetNow = useReactToPrint({ contentRef: countSheetRef, documentTitle: 'Stock Count Sheet' });

const handlePrintCountSheet = useCallback(() => {
  fetchCountSheetData();
}, [fetchCountSheetData]);
```

3. Pass `onPrintCountSheet={handlePrintCountSheet}` to the toolbar and render `CountSheetPrintView` with `countSheetData`.

- [ ] **Step 4: Verify in browser**

- Click Print dropdown → "Print Count Sheet"
- Browser print dialog opens with count sheet layout
- Verify component codes, descriptions, categories, system stock
- Verify blank Counted and Difference columns
- Test with a filter active — only filtered components appear

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/transactions/
git commit -m "feat: printable stock count sheet with on-order section"
```

---

### Task 6: Batch Adjust Mode (Feature 5)

**Files:**
- Create: `components/features/inventory/transactions/BatchAdjustMode.tsx`
- Modify: `components/features/inventory/transactions/TransactionsExplorer.tsx` — batch state
- Modify: `components/features/inventory/transactions/TransactionsToolbar.tsx` — batch button + toolbar

This is the most complex feature. The core idea: when batch mode is active, the component group headers show inline editable "Counted" fields instead of the normal view.

- [ ] **Step 1: Create BatchAdjustMode component**

This component receives the list of component groups and renders them as an editable table. It manages its own local state for counted values.

Key interface:

```typescript
type BatchEntry = {
  componentId: number;
  code: string;
  description: string;
  systemStock: number;
  counted: string; // '' means not yet entered
};

type Props = {
  components: BatchEntry[];
  onApplyAll: (adjustments: Array<{ componentId: number; code: string; systemStock: number; newStock: number }>, reason: string, notes: string) => Promise<void>;
  onCancel: () => void;
};
```

The component renders:
- A table with columns: Code, Description, System, Counted (input), Diff
- Tab/Enter advances to the next row's Counted input
- A summary bar at the bottom: "X items changed" + "Apply All" + "Cancel"
- The "Apply All" button opens a confirmation dialog inline (or a small modal) with a reason dropdown

- [ ] **Step 1b: Create BatchAdjustConfirmDialog**

This is a sub-component used by `BatchAdjustMode`. It receives the list of changed entries and collects a shared reason before applying.

```typescript
// Inside BatchAdjustMode.tsx or as a separate component in the same file

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjustments: Array<{ componentId: number; code: string; systemStock: number; counted: number; diff: number }>;
  onConfirm: (reason: string, notes: string) => void;
  isPending: boolean;
};

function BatchAdjustConfirmDialog({ open, onOpenChange, adjustments, onConfirm, isPending }: ConfirmDialogProps) {
  const [reason, setReason] = useState('cycle_count');
  const [notes, setNotes] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm {adjustments.length} Stock Adjustments</DialogTitle>
        </DialogHeader>

        {/* Summary table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead className="text-right">System</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Adjustment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adjustments.map((a) => (
              <TableRow key={a.componentId}>
                <TableCell className="font-medium">{a.code}</TableCell>
                <TableCell className="text-right">{a.systemStock}</TableCell>
                <TableCell className="text-right">{a.counted}</TableCell>
                <TableCell className={cn('text-right font-semibold', a.diff > 0 ? 'text-green-600' : 'text-red-500')}>
                  {a.diff > 0 ? '+' : ''}{a.diff}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Shared reason — defaults to Cycle Count */}
        <div className="space-y-2">
          <Label>Reason for All Adjustments</Label>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ADJUSTMENT_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onConfirm(reason, notes)} disabled={isPending}>
            {isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Applying...</> : `Confirm ${adjustments.length} Adjustments`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Import `ADJUSTMENT_REASONS` from `StockAdjustmentDialog.tsx` (export it first) or duplicate the array. The dialog is triggered from `BatchAdjustMode` when the user clicks "Apply All":

```typescript
// In BatchAdjustMode:
const changedEntries = entries.filter((e) => e.counted !== '' && Number(e.counted) !== e.systemStock);
// "Apply All" button opens the confirm dialog with changedEntries
```

- [ ] **Step 2: Wire batch mode into TransactionsExplorer**

Add state:

```typescript
const [batchMode, setBatchMode] = useState(false);
```

When `batchMode` is true:
- Auto-switch to component grouping
- Render `BatchAdjustMode` instead of `TransactionsGroupedTable`
- The "Apply All" handler creates individual adjustment mutations via `Promise.allSettled`

```typescript
const handleBatchApply = useCallback(async (
  adjustments: Array<{ componentId: number; code: string; systemStock: number; newStock: number }>,
  reason: string,
  notes: string
) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const results = await Promise.allSettled(
    adjustments.map(async (adj) => {
      const adjustmentQty = adj.newStock - adj.systemStock;
      const fullReason = `${reason}${notes ? `: ${notes}` : ''}`;

      const { error: txError } = await supabase.from('inventory_transactions').insert({
        component_id: adj.componentId,
        quantity: adjustmentQty,
        transaction_type_id: 3, // ADJUSTMENT
        transaction_date: new Date().toISOString(),
        user_id: user.id,
        reason: fullReason,
      });
      if (txError) throw txError;

      const { error: invError } = await supabase.from('inventory').upsert(
        { component_id: adj.componentId, quantity_on_hand: adj.newStock, reorder_level: 0, location: null },
        { onConflict: 'component_id' }
      );
      if (invError) throw invError;

      return adj;
    })
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected');

  if (failed.length === 0) {
    toast.success(`${succeeded} adjustments applied`);
  } else {
    toast.warning(`${succeeded} succeeded, ${failed.length} failed`, {
      description: 'Failed items can be retried individually via the Adjust button.',
    });
  }

  queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions', 'explorer'] });
  queryClient.invalidateQueries({ queryKey: ['component-stock-summary'] });
  setBatchMode(false);
}, [queryClient]);
```

- [ ] **Step 3: Add Batch Adjust button to toolbar**

In `TransactionsToolbar.tsx`, add a "Batch Adjust" button next to Print. When batch mode is active, the toolbar shows the batch controls instead of the normal buttons:

```tsx
{batchMode ? (
  <div className="flex gap-2 items-center">
    <span className="text-xs text-muted-foreground">{changedCount} items changed</span>
    <Button size="sm" onClick={onApplyBatch}>Apply All Adjustments</Button>
    <Button size="sm" variant="outline" onClick={onCancelBatch}>Cancel</Button>
  </div>
) : (
  /* normal buttons */
  <Button variant="outline" size="sm" onClick={onBatchAdjust} className="h-9">
    <ClipboardCheck className="h-4 w-4 mr-1.5" />
    Batch Adjust
  </Button>
)}
```

Add the new props: `batchMode`, `changedCount`, `onBatchAdjust`, `onApplyBatch`, `onCancelBatch`.

- [ ] **Step 4: Verify in browser**

- Click "Batch Adjust" → view switches to component grouping, inline editing mode
- Tab between Counted fields
- Type counted values → see real-time Diff + row highlighting
- Click "Apply All" → confirmation with reason dropdown
- Confirm → adjustments applied, toast shows results
- Cancel → discards changes

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/transactions/
git commit -m "feat: batch adjust mode for inline stock recount"
```

---

### Task 7: Disable Component (Feature 6)

**Files:**
- Modify: `components/features/inventory/transactions/TransactionsGroupedTable.tsx` — add kebab menu
- Modify: component pickers (enumerate first, may be `/batch`)

- [ ] **Step 1: Add kebab menu to component group headers**

In `TransactionsGroupedTable.tsx`, add a `DropdownMenu` next to the Adjust button:

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';

// In the component group header, after the Adjust button:
{isComponentGroup && onDisableComponent && (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => e.stopPropagation()}>
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onClick={(e) => {
        e.stopPropagation();
        onDisableComponent(Number(group.key), group.label);
      }}>
        Disable Component
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)}
```

Add `onDisableComponent?: (componentId: number, componentName: string) => void` to Props.

- [ ] **Step 2: Handle disable in TransactionsExplorer**

```typescript
const handleDisable = useCallback(async (componentId: number, componentName: string) => {
  if (!confirm(`Disable ${componentName}? It will be hidden from PO creation, BOM pickers, and stock issue. Historical data is preserved.`)) return;

  const { error } = await supabase.from('components').update({ is_active: false }).eq('component_id', componentId);
  if (error) {
    toast.error('Failed to disable component');
    return;
  }
  toast.success(`${componentName} disabled`);
  queryClient.invalidateQueries({ queryKey: ['inventory', 'transactions', 'explorer'] });
}, [queryClient]);
```

- [ ] **Step 3: Add is_active filter to component pickers**

First enumerate all files with component picker queries:

```bash
grep -rn "from('components')" --include="*.ts" --include="*.tsx" -l | head -20
```

For each picker that searches components for selection (NOT historical views), add `.eq('is_active', true)` to the query. Common locations:
- `ComponentSearchModal.tsx`
- `product-bom.tsx` (component search)
- `ManualStockIssueTab.tsx`
- `ComponentPickerDialog.tsx`
- `new-purchase-order-form.tsx` (component select)
- The new `ComponentTransferPicker` from Task 4

If the count exceeds 10 files, flag as `/batch` candidate before proceeding.

- [ ] **Step 4: Add inactive badge to group headers**

In `TransactionsGroupedTable.tsx`, check the `is_active` status (will need to be passed through the group data or fetched). Show a muted badge:

```tsx
{!isActive && (
  <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/30">
    Inactive
  </Badge>
)}
```

- [ ] **Step 5: Verify**

- Click kebab → "Disable Component" → confirm
- Component shows "Inactive" badge
- Component no longer appears in PO creation component picker
- Run lint: `npm run lint`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: disable component from transactions page with is_active filter"
```

---

### Task 8: Final Verification + Lint + Security

- [ ] **Step 1: Run lint**
```bash
npm run lint
```

- [ ] **Step 2: Type check**
```bash
npx tsc --noEmit --pretty
```

- [ ] **Step 3: Run Supabase security advisors**
Use `mcp__supabase__get_advisors` with type "security".

- [ ] **Step 4: Browser verification**
Use Chrome MCP to verify the full flow end-to-end:
1. Open transactions tab → By Component → see Adjust buttons, no in/out totals
2. Quick adjust a component → stock updates
3. Save & Next → advances to next component
4. Transfer stock between two components
5. Print count sheet
6. Enter batch adjust mode → edit several rows → Apply All
7. Disable a component → verify it's hidden from pickers

- [ ] **Step 5: Final commit if fixes needed**
```bash
git add -A && git commit -m "fix: address lint/type/security findings from inventory cleanup tools"
```
