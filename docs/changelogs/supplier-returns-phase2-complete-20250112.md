# Phase 2 Complete: Receiving Inspection UI for Supplier Returns

**Date:** 2025-01-12
**Status:** ✅ Complete and Ready for Testing
**Previous Phase:** [Phase 4 - Document Generation](./supplier-returns-phase4-complete-20250115.md)
**Related Plan:** [purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)

---

## Summary

Phase 2 implements the receiving inspection UI that enables operators to reject items at the gate during delivery inspection. The system now supports both receiving good items into inventory AND rejecting defective items in a single transaction, with automatic GRN generation and PDF document download.

### Key Features Delivered

1. **Reject Quantity Field** - Optional field for specifying quantity rejected at gate
2. **Rejection Reason Dropdown** - Predefined reasons plus "Other" option
3. **Running Totals Display** - Real-time calculation of Ordered/Receiving/Rejecting/Balance
4. **Integrated Workflow** - Single form handles both receipts and rejections
5. **Automatic GRN Generation** - Rejection creates return record with unique GRN
6. **Instant PDF Download** - PDF download buttons appear immediately after rejection

---

## What Was Delivered

### 1. Enhanced Receiving Form UI

**File:** [components/features/purchasing/order-detail.tsx](../../components/features/purchasing/order-detail.tsx)

#### Running Totals Display
Shows real-time calculations as operator fills out the form:
- **Ordered:** Total quantity on the purchase order
- **Receiving:** Quantity being received (good items)
- **Rejecting:** Quantity being rejected (defective items)
- **Balance:** Remaining quantity after this transaction

```typescript
// Running totals calculate dynamically
const quantityReceived = watch('quantity_received') || 0;
const quantityRejected = watch('quantity_rejected') || 0;
const balance = remainingQuantity - quantityReceived - quantityRejected;
```

#### Quantity Received Field
- **Purpose:** Good items to receive into inventory
- **Validation:** Must be positive number
- **Maximum:** Cannot exceed remaining order quantity
- **Help Text:** "Good items to receive into inventory"

#### Quantity Rejected Field (Optional)
- **Purpose:** Items rejected at gate (do NOT enter inventory)
- **Validation:** Must be non-negative number, optional
- **Maximum:** Cannot exceed remaining order quantity
- **Help Text:** "Rejected at gate - will NOT enter inventory"
- **Conditional Reason:** If rejection quantity > 0, rejection reason becomes required

#### Rejection Reason Dropdown (Conditional)
- **Visibility:** Only shown when quantity_rejected > 0
- **Required:** Yes (when rejections present)
- **Options:**
  - Damaged on arrival
  - Wrong part received
  - Incorrect quantity
  - Poor quality
  - Missing documentation
  - Late delivery
  - Other

### 2. Updated Form Validation

**File:** [types/purchasing.ts](../../types/purchasing.ts)

Enhanced `ReceiveItemsFormValues` type:

```typescript
export type ReceiveItemsFormValues = {
  quantity_received: number;
  quantity_rejected?: number;
  rejection_reason?: string;
  receipt_date?: string;
};
```

Zod schema with cross-field validation:

```typescript
const receiveItemsSchema = z.object({
  quantity_received: z.number().positive('Quantity must be positive'),
  quantity_rejected: z.number().nonnegative().optional(),
  rejection_reason: z.string().optional(),
  receipt_date: z.string().optional(),
}).refine(
  (data) => {
    // If rejection quantity provided, rejection reason is required
    if (data.quantity_rejected && data.quantity_rejected > 0 && !data.rejection_reason) {
      return false;
    }
    return true;
  },
  {
    message: 'Rejection reason is required when rejecting items',
    path: ['rejection_reason'],
  }
);
```

### 3. Integrated Receipt/Rejection Processing

**File:** [components/features/purchasing/order-detail.tsx](../../components/features/purchasing/order-detail.tsx)

The `processReceipt` function now handles both workflows:

```typescript
async function processReceipt(
  orderId: number,
  componentId: number,
  data: ReceiveItemsFormValues
): Promise<{ grn?: string }> {
  const receiptTimestamp = data.receipt_date || new Date().toISOString();
  let generatedGrn: string | undefined;

  // Process rejections first (if any)
  if (data.quantity_rejected && data.quantity_rejected > 0) {
    const { data: returnData, error: returnError } = await supabase.rpc(
      'process_supplier_order_return',
      {
        p_supplier_order_id: orderId,
        p_quantity: data.quantity_rejected,
        p_reason: data.rejection_reason,
        p_return_type: 'rejection',
        p_return_date: receiptTimestamp,
      }
    );

    if (returnError) {
      throw new Error(`Failed to process rejection: ${returnError.message}`);
    }

    // Extract GRN from return result
    if (returnData && Array.isArray(returnData) && returnData.length > 0) {
      generatedGrn = returnData[0].goods_return_number || returnData[0];
    }
  }

  // Process receipt for accepted items (if any)
  if (data.quantity_received && data.quantity_received > 0) {
    await supabase.rpc('process_supplier_order_receipt', {
      p_order_id: orderId,
      p_quantity: data.quantity_received,
      p_receipt_date: receiptTimestamp,
    });
  }

  return { grn: generatedGrn };
}
```

### 4. PDF Download Section

**File:** [components/features/purchasing/order-detail.tsx](../../components/features/purchasing/order-detail.tsx)

After successful rejection, a PDF download section appears:

```typescript
{lastGeneratedGrn && order.q_number && (
  <div className="mt-6 pt-6 border-t">
    <h4 className="text-sm font-medium mb-3">Goods Returned Document</h4>
    <p className="text-sm text-muted-foreground mb-3">
      GRN: <span className="font-mono font-medium">{lastGeneratedGrn}</span>
    </p>
    <ReturnGoodsPDFDownload
      goodsReturnNumber={lastGeneratedGrn}
      purchaseOrderNumber={order.q_number}
      purchaseOrderId={order.purchase_order_id || 0}
      returnDate={new Date().toISOString()}
      items={[
        {
          component_code: order.supplierComponent.component.internal_code,
          component_name: order.supplierComponent.component.description || '',
          quantity_returned: quantityRejected,
          reason: watch('rejection_reason') || 'Rejected at gate',
          return_type: 'rejection',
        },
      ]}
      supplierInfo={{
        supplier_name: order.supplierComponent.supplier.name,
      }}
      returnType="rejection"
    />
  </div>
)}
```

---

## User Workflow

### Scenario 1: Receive All Good Items

1. Operator goes to purchase order detail page
2. Enters quantity in "Quantity Received" field (e.g., 10)
3. Running totals show: Ordered: 10, Receiving: 10, Rejecting: 0, Balance: 0
4. Clicks "Record Receipt"
5. Items enter inventory, order status updates

### Scenario 2: Reject All Items at Gate

1. Operator goes to purchase order detail page
2. Leaves "Quantity Received" at 0
3. Enters quantity in "Quantity Rejected" field (e.g., 10)
4. Rejection reason dropdown appears
5. Selects reason (e.g., "Damaged on arrival")
6. Running totals show: Ordered: 10, Receiving: 0, Rejecting: 10, Balance: 0
7. Clicks "Record Receipt"
8. GRN is generated (e.g., "GRN-25-0001")
9. PDF download section appears with Download and Open buttons
10. Items do NOT enter inventory, order status updates

### Scenario 3: Partial Receipt with Rejections (Mixed)

1. Operator goes to purchase order detail page
2. Receives 7 good items, rejects 3 defective items
3. Enters 7 in "Quantity Received"
4. Enters 3 in "Quantity Rejected"
5. Selects rejection reason (e.g., "Poor quality")
6. Running totals show: Ordered: 10, Receiving: 7, Rejecting: 3, Balance: 0
7. Clicks "Record Receipt"
8. 7 items enter inventory, 3 items create return record with GRN
9. PDF download section appears for the rejection
10. Order status updates to reflect both actions

---

## Database Integration

### RPC Called: `process_supplier_order_return`

**Parameters:**
- `p_supplier_order_id` - The order being rejected
- `p_quantity` - Quantity rejected
- `p_reason` - Rejection reason from dropdown
- `p_return_type` - Always 'rejection' for gate rejections
- `p_return_date` - Receipt timestamp

**Returns:**
- Array with return record including `goods_return_number` (GRN)

**Side Effects:**
- Creates record in `supplier_order_returns` table
- Generates unique GRN via sequence (format: GRN-YY-####)
- Creates inventory transaction (SALE type, negative quantity)
- **DOES NOT** decrement inventory (rejection logic)
- Updates order status if needed

### RPC Called: `process_supplier_order_receipt`

**Parameters:**
- `p_order_id` - The order being received
- `p_quantity` - Quantity received
- `p_receipt_date` - Receipt timestamp

**Side Effects:**
- Creates record in `supplier_order_receipts` table
- Creates inventory transaction (PURCHASE type, positive quantity)
- **DOES** increment inventory quantity
- Updates `total_received` on order
- Updates order status (Partially Received or Fully Received)

---

## Testing Checklist

### Manual Testing Steps

**Prerequisites:**
1. Supplier order exists with Q number assigned
2. Order has remaining quantity > 0
3. Dev server running at `http://localhost:3000`
4. Authenticated user session

**Test 1: Pure Rejection (No Receipt)**
- [ ] Navigate to purchase order detail page (e.g., `/purchasing/purchase-orders/73`)
- [ ] Verify running totals display shows correct ordered quantity
- [ ] Enter quantity in "Quantity Rejected" field
- [ ] Verify rejection reason dropdown appears
- [ ] Verify running totals update: Rejecting shows entered value
- [ ] Select rejection reason
- [ ] Click "Record Receipt"
- [ ] Verify success (no error messages)
- [ ] Verify GRN displayed (format: GRN-25-####)
- [ ] Verify PDF download buttons appear (Download PDF, Open PDF)
- [ ] Click "Download PDF" - verify PDF downloads with correct data
- [ ] Click "Open PDF" - verify PDF opens in new tab
- [ ] Check database: verify return record created with return_type='rejection'
- [ ] Check inventory: verify quantity_on_hand did NOT decrease

**Test 2: Mixed Receipt and Rejection**
- [ ] Navigate to purchase order with remaining quantity >= 10
- [ ] Enter 7 in "Quantity Received"
- [ ] Enter 3 in "Quantity Rejected"
- [ ] Select rejection reason
- [ ] Verify running totals: Receiving: 7, Rejecting: 3, Balance: 0
- [ ] Click "Record Receipt"
- [ ] Verify both transactions processed successfully
- [ ] Verify GRN displayed for rejection
- [ ] Verify PDF download buttons appear
- [ ] Check database: verify receipt record created (qty: 7)
- [ ] Check database: verify return record created (qty: 3, type: rejection)
- [ ] Check inventory: verify quantity_on_hand increased by 7 (not 10)

**Test 3: Validation - Rejection Without Reason**
- [ ] Enter quantity in "Quantity Rejected"
- [ ] Leave rejection reason blank
- [ ] Click "Record Receipt"
- [ ] Verify error message: "Rejection reason is required when rejecting items"

**Test 4: Running Totals Accuracy**
- [ ] Order quantity: 100, Total received: 50, Remaining: 50
- [ ] Enter 30 in "Quantity Received"
- [ ] Verify running totals: Ordered: 100, Receiving: 30, Rejecting: 0, Balance: 20
- [ ] Enter 10 in "Quantity Rejected"
- [ ] Verify running totals: Ordered: 100, Receiving: 30, Rejecting: 10, Balance: 10

---

## Files Modified

### Modified
- [components/features/purchasing/order-detail.tsx](../../components/features/purchasing/order-detail.tsx) - Added rejection UI and workflow integration
- [types/purchasing.ts](../../types/purchasing.ts) - Added rejection fields to `ReceiveItemsFormValues`

### No New Files
Phase 2 enhances existing components only.

---

## Build Verification

```bash
$ npm run build
 ✓ Compiled successfully in 43s
 ✓ Generating static pages (64/64) in 7.6s
 ✓ Build completed successfully
```

**TypeScript Errors:** 0
**Build Warnings:** 4 (unrelated prettier warnings from dependencies)
**Exit Code:** 0 ✅

---

## Integration with Other Phases

### Phase 1 (Schema & Storage) ✅
- Uses `process_supplier_order_return` RPC with `return_type='rejection'`
- Rejection logic: items do NOT decrement inventory
- GRN generation works automatically

### Phase 4 (Document Generation) ✅
- Uses `ReturnGoodsPDFDownload` component
- PDF generation triggered immediately after rejection
- GRN displayed prominently in UI and PDF

### Future Phases

**Phase 5 (Signature Collection):**
- PDF can be printed and signed by driver
- Signed PDF can be uploaded to `supplier-returns` storage
- Track signature status transitions

**Phase 6 (Email Infrastructure):**
- After PDF download, operator can optionally email to supplier
- Email will include PDF download link
- Track email status and sent timestamp

---

## Success Metrics

- [x] Reject Qty field added to receiving form
- [x] Rejection reason dropdown with 7 common reasons
- [x] Running totals display (Ordered/Receiving/Rejecting/Balance)
- [x] Form validation: rejection reason required when qty_rejected > 0
- [x] Integration with `process_supplier_order_return` RPC
- [x] GRN captured and displayed after rejection
- [x] PDF download buttons appear after rejection
- [x] Builds without TypeScript errors
- [ ] Manual test: Pure rejection workflow (pending authentication)
- [ ] Manual test: Mixed receipt and rejection (pending authentication)
- [ ] Manual test: PDF generation and download (pending authentication)

---

## Known Limitations

1. **Authentication Required for Testing:** Chrome DevTools MCP uses isolated browser profile without authentication cookies. For authenticated testing, use regular browser manually at `http://localhost:3000`.

2. **Q Number Required for PDF:** PDF download only appears if order has `q_number` assigned. Orders in Draft/Open status without Q numbers will not show PDF download section.

3. **Single Component Per Transaction:** Current implementation handles one component at a time. Batch rejections across multiple components require separate transactions.

---

## Next Steps

### Recommended: Phase 6 (Email Infrastructure)

With Phase 2 complete, the core rejection workflow is functional. Next logical step is automating supplier communications:

1. Create email template for supplier notifications
2. Integrate with Resend API (already in project)
3. Send email with PDF download link after rejection
4. Track email status fields (`email_status`, `email_sent_at`, `email_message_id`)
5. Add "Send Email" and "Skip Email" buttons to UI

**Alternative:** Phase 5 (Signature Collection)
- Add file upload for signed PDFs
- Update `signed_document_url` field
- Track signature status transitions
- Display signature collection progress

---

## References

- **Full Plan:** [docs/plans/purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)
- **Phase 1 Complete:** [docs/changelogs/PHASE1_COMPLETE.md](./PHASE1_COMPLETE.md)
- **Phase 4 Complete:** [docs/changelogs/supplier-returns-phase4-complete-20250115.md](./supplier-returns-phase4-complete-20250115.md)
- **Project Status:** [docs/PROJECT_STATUS.md](../PROJECT_STATUS.md)
- **Migration File:** [migrations/20250115_enhance_supplier_returns.sql](../../migrations/20250115_enhance_supplier_returns.sql)

---

**Phase 2 Status: ✅ COMPLETE - Ready for Manual Testing**

The receiving inspection UI is fully implemented and builds successfully. Operators can now reject items at the gate during delivery inspection, with automatic GRN generation and instant PDF document download. Manual testing with authenticated browser session required to verify end-to-end workflow.
