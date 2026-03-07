# Receipt + Rejection Allocation Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the receiving flow so that when items are received AND rejected simultaneously on a split PO line, allocations only need to sum to the *good* quantity (received minus rejected), not the gross received.

**Architecture:** Add a `p_rejected_quantity` parameter to the existing `process_supplier_order_receipt` RPC so it handles both receipt and gate rejection in a single atomic transaction. The RPC adds only good items to stock, creates the return record for rejected items internally, and requires allocations to sum to good quantity only. The frontend stops calling the return RPC separately for gate rejections (it's still used for later returns). Also fix the missing org membership check on the return RPC.

**Tech Stack:** PostgreSQL (Supabase migration), React/TypeScript (Next.js), react-hook-form, Zod

---

### Task 1: Backend Migration — Extend Receipt RPC with Gate Rejection Support

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_receipt_with_gate_rejection.sql`

**What this migration does:**

Replaces `process_supplier_order_receipt` with a new version that accepts an optional `p_rejected_quantity integer DEFAULT NULL` and optional `p_rejection_reason text DEFAULT NULL`. When provided:

1. `p_quantity` remains the **gross** quantity from the invoice (e.g. 45) — used for the receipt audit record
2. `v_good_quantity = p_quantity - p_rejected_quantity` (e.g. 40) — this is what goes to stock and what allocations must sum to
3. Inventory gets `v_good_quantity` added (not the full `p_quantity`)
4. Allocation validation: `v_payload_sum = v_good_quantity` (not `p_quantity`)
5. The RPC internally creates the return record (same as `process_supplier_order_return` does today: negative inventory txn, `supplier_order_returns` row with GRN, status recompute)
6. `total_received` on the supplier order = receipts - returns (unchanged logic)
7. Returns the existing columns PLUS `goods_return_number text` and `return_id bigint` (nullable, only set when rejection happened)

When `p_rejected_quantity` is NULL or 0, behavior is identical to today (backward compatible).

**Step 1: Write the migration SQL**

The migration must:
- `CREATE OR REPLACE FUNCTION process_supplier_order_receipt(...)` with the two new optional params
- Keep the existing 4-param signature working (backward compatible via defaults)
- Inside the function body, after the existing receipt logic but before the inventory update:
  - Compute `v_good_quantity := p_quantity - COALESCE(p_rejected_quantity, 0)`
  - Change inventory update from `+ p_quantity` to `+ v_good_quantity`
  - Change allocation sum check from `v_payload_sum <> p_quantity` to `v_payload_sum <> v_good_quantity`
  - Change over-receipt guard to use `v_good_quantity` for remaining capacity
  - If `p_rejected_quantity > 0`: create the return record inline (GRN generation, negative inventory txn, `supplier_order_returns` insert)
- Recompute `total_received` accounting for the new return
- Add the org membership check that's currently missing from the return RPC (also fix it there separately in Task 2)
- Return type adds `goods_return_number text` and `return_id bigint`

**Key SQL logic for the rejection block inside the receipt RPC:**

```sql
-- After receipt record is created, handle gate rejection
v_good_quantity := p_quantity - COALESCE(p_rejected_quantity, 0);

IF COALESCE(p_rejected_quantity, 0) > 0 THEN
  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'rejection reason required when rejected quantity > 0';
  END IF;

  -- Generate GRN (same logic as return RPC)
  SELECT 'GRN-' || to_char(now(), 'YY') || '-' ||
         lpad((coalesce(max(
           CASE WHEN sor.goods_return_number ~ '^GRN-[0-9]{2}-[0-9]+$'
           THEN substring(sor.goods_return_number from 8)::integer ELSE 0 END
         ), 0) + 1)::text, 4, '0')
  INTO v_grn
  FROM supplier_order_returns sor
  WHERE sor.goods_return_number LIKE 'GRN-' || to_char(now(), 'YY') || '-%';

  -- Negative inventory transaction for rejected items
  INSERT INTO inventory_transactions (
    component_id, quantity, transaction_type_id, transaction_date,
    supplier_order_id, purchase_order_id, user_id, reason
  ) VALUES (
    v_comp_id, -p_rejected_quantity, v_sale_type_id, v_receipt_ts,
    p_order_id, v_order.purchase_order_id, auth.uid(), p_rejection_reason
  );

  -- Return record
  INSERT INTO supplier_order_returns (
    supplier_order_id, transaction_id, quantity_returned, return_date,
    reason, return_type, receipt_id, user_id, goods_return_number
  ) VALUES (
    p_order_id, v_txn_id, p_rejected_quantity, v_receipt_ts,
    p_rejection_reason, 'rejection', v_new_receipt.receipt_id, auth.uid(), v_grn
  ) RETURNING return_id, goods_return_number INTO v_return_id, v_grn;
END IF;
```

**Allocation sum check changes from:**
```sql
IF v_payload_sum <> p_quantity::numeric THEN
```
**To:**
```sql
IF v_payload_sum <> v_good_quantity::numeric THEN
```

**Inventory update changes from:**
```sql
SET quantity_on_hand = COALESCE(inventory.quantity_on_hand, 0) + p_quantity
```
**To:**
```sql
SET quantity_on_hand = COALESCE(inventory.quantity_on_hand, 0) + v_good_quantity
```

**Step 2: Apply migration via Supabase MCP**

Run: `mcp__supabase__apply_migration` with name `receipt_with_gate_rejection`

**Step 3: Verify with test query**

```sql
-- Verify function signature has new params
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc WHERE proname = 'process_supplier_order_receipt';
```

Expected: shows `p_rejected_quantity integer DEFAULT NULL, p_rejection_reason text DEFAULT NULL` in the args.

**Step 4: Commit**

```bash
git add supabase/migrations/*receipt_with_gate_rejection*
git commit -m "feat: extend receipt RPC to handle gate rejection atomically

Adds optional p_rejected_quantity and p_rejection_reason params.
When provided, only good qty goes to stock, allocations sum to good qty,
and the return record is created within the same transaction."
```

---

### Task 2: Backend Migration — Add Org Membership Check to Return RPC

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_return_rpc_add_org_check.sql`

**Context:** The receipt RPC has `IF v_order.org_id IS NOT NULL AND auth.role() <> 'service_role' AND NOT is_org_member(v_order.org_id) THEN RAISE EXCEPTION 'access denied'`. The return RPC is missing this check despite being SECURITY DEFINER.

**Step 1: Write the migration**

Add the org membership check to `process_supplier_order_return` immediately after the `SELECT ... INTO v_order` block:

```sql
IF v_order.org_id IS NOT NULL AND auth.role() <> 'service_role' AND NOT is_org_member(v_order.org_id) THEN
  RAISE EXCEPTION 'process_supplier_order_return: access denied';
END IF;
```

Note: Need to add `v_order.org_id` to the SELECT (currently only selects `order_id, supplier_component_id, order_quantity, total_received, status_id, purchase_order_id`). Add `so.org_id` to the select.

**Step 2: Apply migration**

**Step 3: Verify**

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'process_supplier_order_return';
-- Confirm 'is_org_member' appears in the body
```

**Step 4: Commit**

```bash
git add supabase/migrations/*return_rpc_add_org_check*
git commit -m "fix: add org membership check to return RPC (security)"
```

---

### Task 3: Frontend — Update ReceiveItemsModal Allocation Validation and Submit

**Files:**
- Modify: `app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx`

**Step 1: Fix allocation mismatch validation (line 191)**

Change from:
```tsx
const allocationMismatch = hasSplitAllocations && quantityReceived > 0 && allocationReceivedNowTotal !== quantityReceived;
```
To:
```tsx
const goodQuantity = quantityReceived - quantityRejected;
const allocationMismatch = hasSplitAllocations && goodQuantity > 0 && allocationReceivedNowTotal !== goodQuantity;
```

**Step 2: Fix allocation total display (line ~519)**

Change from:
```tsx
Allocation total: {allocationReceivedNowTotal} / {quantityReceived || 0}
```
To:
```tsx
Allocation total: {allocationReceivedNowTotal} / {goodQuantity || 0}
```

**Step 3: Fix error message (line ~522)**

Change from:
```
Allocation total must exactly match Quantity Received.
```
To:
```
Allocation total must match good quantity (Received − Rejected).
```

**Step 4: Update onSubmit to use combined RPC**

In the submit handler (~line 246-286), when there are rejections, pass them to the receipt RPC instead of calling the return RPC separately:

```tsx
// Build receipt RPC payload
const rpcPayload: {
  p_order_id: number;
  p_quantity: number;
  p_receipt_date: string;
  p_allocation_receipts?: AllocationReceipt[] | null;
  p_rejected_quantity?: number;
  p_rejection_reason?: string;
} = {
  p_order_id: supplierOrder.order_id,
  p_quantity: data.quantity_received || 0,
  p_receipt_date: receiptTimestamp,
};

if (allocationPayload) {
  rpcPayload.p_allocation_receipts = allocationPayload;
}

// Include rejection in the same atomic call
if ((data.quantity_rejected || 0) > 0) {
  rpcPayload.p_rejected_quantity = data.quantity_rejected;
  rpcPayload.p_rejection_reason = data.rejection_reason;
}
```

Also update the allocation validation in onSubmit (~line 257-260):

```tsx
const goodQty = (data.quantity_received || 0) - (data.quantity_rejected || 0);
if (payloadTotal !== goodQty) {
  throw new Error('Allocation breakdown must equal good quantity (received minus rejected)');
}
```

Remove the separate return RPC call block (~lines 289-313) since it's now handled by the receipt RPC. Keep the success state handling but extract GRN/returnId from the receipt RPC response instead.

**Step 5: Verify with `npx tsc --noEmit`**

**Step 6: Commit**

```bash
git add app/purchasing/purchase-orders/[id]/ReceiveItemsModal.tsx
git commit -m "fix: allocation breakdown matches good qty, not gross received

When rejecting items during receiving, allocations now only need to
sum to (received - rejected). Uses combined receipt+rejection RPC."
```

---

### Task 4: Frontend — Update BulkReceiveModal Allocation Validation and Submit

**Files:**
- Modify: `app/purchasing/purchase-orders/[id]/BulkReceiveModal.tsx`

**Step 1: Fix `getAllocationPayloadForOrder` (line 176)**

Change from:
```tsx
if (payloadSum !== qtyReceived) {
```
To:
```tsx
if (payloadSum !== qtyGood) {
```

The function needs a new `qtyRejected` parameter:

```tsx
const getAllocationPayloadForOrder = (
    orderId: number,
    qtyReceived: number,
    qtyRejected: number
): AllocationReceipt[] | null => {
    ...
    const qtyGood = qtyReceived - qtyRejected;
    ...
    if (payloadSum !== qtyGood) {
        throw new Error(`Allocation breakdown must equal good quantity for order ${orderId}`);
    }
```

**Step 2: Fix allocation mismatch display (line 445)**

Change from:
```tsx
const allocationMismatch = hasSplitAllocations && receiveNow > 0 && allocationTotal !== receiveNow;
```
To:
```tsx
const rejectNow = watch(`items.${index}.quantity_rejected`) || 0;
const goodNow = receiveNow - rejectNow;
const allocationMismatch = hasSplitAllocations && goodNow > 0 && allocationTotal !== goodNow;
```

Update the display text similarly to show `goodNow` instead of `receiveNow`.

**Step 3: Update submit to use combined RPC (line ~287-313)**

Same pattern as Task 3 — pass `p_rejected_quantity` and `p_rejection_reason` to the receipt RPC, remove separate return RPC call for items that also have receipts. Keep the standalone return call for items where `quantity_received === 0 && quantity_rejected > 0` (reject-only, no receipt).

Update the caller at line ~287-289:
```tsx
const allocationPayload = getAllocationPayloadForOrder(
    item.order_id,
    item.quantity_received || 0,
    item.quantity_rejected || 0
);
```

**Step 4: Verify with `npx tsc --noEmit`**

**Step 5: Commit**

```bash
git add app/purchasing/purchase-orders/[id]/BulkReceiveModal.tsx
git commit -m "fix: bulk receive allocation matches good qty, uses combined RPC"
```

---

### Task 5: End-to-End Verification

**Step 1: Manual test via browser**

Navigate to a PO with split allocations. Test:
- Receive 45, reject 5 → allocation inputs should need to sum to 40
- Receive 50, reject 0 → allocation inputs should need to sum to 50 (unchanged behavior)
- Receive 0, reject 5 → no allocation section needed (reject-only)

**Step 2: Verify inventory math**

```sql
-- After test receipt, check:
-- 1. supplier_order_receipts.quantity_received = 45 (gross)
-- 2. supplier_order_returns.quantity_returned = 5
-- 3. inventory.quantity_on_hand increased by 40 (net)
-- 4. supplier_orders.total_received = 40 (net)
-- 5. supplier_order_customer_orders.received_quantity sums to 40
```

**Step 3: Run security advisors**

```
mcp__supabase__get_advisors (security)
```

**Step 4: Run type check and lint**

```bash
npx tsc --noEmit && npm run lint
```

**Step 5: Final commit if any fixes needed**
