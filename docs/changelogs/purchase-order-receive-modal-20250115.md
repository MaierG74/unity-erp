# Purchase Order Receive Modal Enhancement

**Date:** January 15, 2025
**Type:** Feature Enhancement
**Status:** 🚧 In Progress
**Related:** Phase 7 - Stock Returns UI

---

## Overview

Enhanced the Purchase Order detail page (`/purchasing/purchase-orders/[id]`) with a comprehensive modal dialog for receiving items with inspection and rejection capabilities. This replaces the previous inline input box approach with a full-featured modal that supports:

- Recording quantity received
- Recording quantity rejected at gate inspection (no inventory impact)
- Requiring rejection reasons when items are rejected
- GRN (Goods Return Number) generation
- PDF document generation for returns
- Email notifications to suppliers

---

## Implementation Status

### ✅ Completed

1. **Created ReceiveItemsModal Component** - [`app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx`](../../../app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx)
   - Full React Hook Form integration with Zod validation
   - Cross-field validation (rejection reason required when quantity_rejected > 0)
   - Dual workflow support: receiving + rejection in single form
   - Success state with GRN display, PDF download, and email notification
   - Integration with existing Phase 4 PDF generation and Phase 6 email features

2. **Updated Purchase Order Page** - [`app/purchasing/purchase-orders/[id]/page.tsx`](../../../app/purchasing/purchase-orders/[id]/page.tsx)
   - Added modal state management (`receiveModalOpen`, `selectedOrderForReceive`)
   - Replaced inline input+button with "Receive" button that opens modal
   - Added modal component with proper query invalidation on success

3. **Database Functions**
   - `process_supplier_order_receipt` - Records received items
   - `process_supplier_order_return` - Records rejections (type='rejection')
   - Fixed via migration `20250113_fix_rpc_overload_conflict_v6.sql`

### 🚧 Current Issue

**Modal Not Appearing in Browser**

Despite all code being in place:
- Import statement exists (line 20)
- State variables declared (lines 584-585)
- Button correctly configured (lines 1231-1241)
- Modal component rendered (lines 1625-1639)
- File timestamps confirm recent saves

The changes are not appearing in the browser even after:
- Dev server restart
- Hard refresh (Cmd+Shift+R)
- `.next` cache deletion recommended

**Possible Causes:**
- Next.js build cache not clearing properly
- TypeScript compilation error preventing rebuild
- Browser caching issue
- Dev server not detecting file changes

### ℹ️ 2025-01-16 Update

- Updated every impacted Next.js API route to await `context.params` (required since v15+) so `tsc --noEmit` can complete and Turbopack stops discarding new bundles.
- Fixed the Radix Dialog wiring in `ReceiveItemsModal` so `onOpenChange` no longer triggers the close routine during the initial open transition—the modal now stays visible after clicking "Receive".
- When opening the modal, the selected supplier order is now decorated with its parent purchase-order metadata so the success view/PDF generation can safely reference `q_number` and `purchase_order_id`.
- The success state persists the submitted receive/reject quantities, enabling accurate GRN summaries, PDF content, and email prompts even after the form resets.
- Closing the modal (overlay, Cancel, or Done button) now also clears the selected order, preventing stale state on subsequent openings.

---

## Technical Details

### Component Interface

```typescript
interface ReceiveItemsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierOrder: {
    order_id: number;
    supplier_component_id: number;
    order_quantity: number;
    total_received: number;
    // ... other fields
  };
  onSuccess: () => void;
}
```

### Form Schema

```typescript
const receiveItemsSchema = z.object({
  quantity_received: z.number().min(0, 'Cannot be negative'),
  quantity_rejected: z.number().min(0, 'Cannot be negative').optional(),
  rejection_reason: z.string().optional(),
  receipt_date: z.string().optional(),
  notes: z.string().optional(),
}).refine(
  (data) => {
    // Rejection reason required when quantity_rejected > 0
    if ((data.quantity_rejected || 0) > 0 && (!data.rejection_reason || data.rejection_reason.trim() === '')) {
      return false;
    }
    return true;
  },
  {
    message: 'Rejection reason is required when rejecting items',
    path: ['rejection_reason'],
  }
).refine(
  (data) => {
    // Must receive or reject at least one item
    const total = (data.quantity_received || 0) + (data.quantity_rejected || 0);
    return total > 0;
  },
  {
    message: 'Must receive or reject at least one item',
    path: ['quantity_received'],
  }
);
```

### Workflow

1. **User clicks "Receive" button** on a supplier order row
2. **Modal opens** with form pre-populated with max quantities
3. **User enters**:
   - Quantity received (adds to inventory)
   - Quantity rejected (gate rejection, no inventory impact)
   - Rejection reason (required if rejecting items)
   - Optional notes
4. **On submit**:
   - Calls `process_supplier_order_receipt` for received items
   - Calls `process_supplier_order_return` (type='rejection') for rejected items
   - Generates GRN for the return
5. **Success state shows**:
   - GRN number (format: GRN-25-####)
   - "Download PDF" button (integrates Phase 4 PDF generation)
   - "Send Email" button (integrates Phase 6 email notification)

---

## Files Modified

### New Files
- `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx` (16,748 bytes)

### Modified Files
- `app/purchasing/purchase-orders/[id]/page.tsx` (64,416 bytes)
  - Line 20: Added import
  - Lines 584-585: Added state management
  - Lines 1231-1241: Replaced inline input with button
  - Lines 1625-1639: Added modal component

---

## Next Steps

1. **Resolve build/cache issue** to get modal appearing in browser
2. **Test complete workflow**:
   - Open modal
   - Fill form with received/rejected quantities
   - Submit and verify GRN generation
   - Test PDF download
   - Test email notification
3. **Verify database updates**:
   - `supplier_orders.total_received` increments correctly
   - `inventory_transactions` records created
   - `supplier_order_returns` entries for rejections
   - `inventory.quantity_on_hand` updates only for received items (not rejections)

---

## Related Documentation

- [Supplier Returns Enhancement - Phase 1](./supplier-returns-enhancement-phase1-20250115.md)
- [Supplier Returns Enhancement - Phase 4](./supplier-returns-phase4-document-generation-20250115.md)
- [Supplier Returns Enhancement - Phase 6](./supplier-returns-phase6-complete-20250112.md)
- [RPC Overload Fix](./supplier-returns-rpc-overload-fix-20250113.md)
- [Purchasing Master Doc](../domains/purchasing/purchasing-master.md)
