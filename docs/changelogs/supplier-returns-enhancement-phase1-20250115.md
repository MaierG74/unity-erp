# Supplier Returns Enhancement - Phase 1: Schema & Storage

**Date:** 2025-01-15
**Phase:** 1 of 9 (Foundation)
**Status:** Ready for Deployment
**Related Plan:** [purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)

## Overview

Phase 1 establishes the database foundation for the Receiving Inspection & Returns Documentation system. This phase adds support for:

- **GRN (Goods Return Number)** generation and tracking
- **Document storage** for unsigned and signed PDFs
- **Email notification** tracking (sent/skipped/failed)
- **Signature collection** status (none/operator/driver)
- **Batch returns** (multi-component returns under single GRN)
- **Conditional inventory logic** (rejections vs. later returns)

## Critical Behavior Change

### Before This Migration
All returns decremented inventory regardless of `return_type`:
```sql
-- OLD BEHAVIOR
process_supplier_order_return(..., p_return_type := 'rejection')
-- → Decremented inventory (INCORRECT for gate rejections)

process_supplier_order_return(..., p_return_type := 'later_return')
-- → Decremented inventory (correct)
```

### After This Migration
Inventory decrement is conditional based on `return_type`:
```sql
-- NEW BEHAVIOR
process_supplier_order_return(..., p_return_type := 'rejection')
-- → Does NOT decrement inventory (goods never entered stock)

process_supplier_order_return(..., p_return_type := 'later_return')
-- → DOES decrement inventory (taking goods out of stock)
```

## Migration Details

### File
[migrations/20250115_enhance_supplier_returns.sql](../../migrations/20250115_enhance_supplier_returns.sql)

### Schema Changes

#### New Columns on `supplier_order_returns`

| Column | Type | Description |
|--------|------|-------------|
| `document_url` | text | URL to unsigned PDF in storage |
| `signed_document_url` | text | URL to signed PDF after signature collection |
| `document_version` | smallint | Version tracking (default 1) |
| `email_status` | text | `sent` / `skipped` / `failed` |
| `email_sent_at` | timestamptz | When email was sent |
| `email_message_id` | text | Provider message ID |
| `goods_return_number` | text (unique) | GRN format: `GRN-25-0001` |
| `batch_id` | bigint | Groups multi-component returns |
| `signature_status` | text | `none` / `operator` / `driver` |

#### New Database Objects

**Sequence:**
```sql
goods_return_number_seq -- Atomic counter for GRN generation
```

**Functions:**
```sql
generate_goods_return_number(p_purchase_order_id bigint)
-- Returns: GRN-YY-#### format

process_supplier_order_return(...) -- Modified with 3 new parameters
-- New params: p_goods_return_number, p_batch_id, p_signature_status
-- New return column: goods_return_number
```

**Indexes:**
- `idx_supplier_order_returns_goods_return_number`
- `idx_supplier_order_returns_batch_id`
- `idx_supplier_order_returns_email_status`

### Storage Setup

**Required manual step:**
Create storage bucket `supplier-returns` in Supabase Dashboard with policies for authenticated read/write.

See: [migrations/README_PHASE1_DEPLOYMENT.md](../../migrations/README_PHASE1_DEPLOYMENT.md)

## Testing

### Unit Tests

**Test 1: Rejection does NOT decrement inventory**
```sql
-- Get inventory before rejection
SELECT quantity_on_hand FROM inventory WHERE component_id = 123;
-- Result: 100

-- Process rejection
SELECT * FROM process_supplier_order_return(
  p_supplier_order_id := 456,
  p_quantity := 10,
  p_reason := 'Damaged on arrival',
  p_return_type := 'rejection'
);

-- Verify inventory UNCHANGED
SELECT quantity_on_hand FROM inventory WHERE component_id = 123;
-- Expected: 100 (no change)
```

**Test 2: Later return DOES decrement inventory**
```sql
-- Get inventory before return
SELECT quantity_on_hand FROM inventory WHERE component_id = 123;
-- Result: 100

-- Process later return
SELECT * FROM process_supplier_order_return(
  p_supplier_order_id := 456,
  p_quantity := 10,
  p_reason := 'Defect found in production',
  p_return_type := 'later_return'
);

-- Verify inventory DECREMENTED
SELECT quantity_on_hand FROM inventory WHERE component_id = 123;
-- Expected: 90 (decreased by 10)
```

**Test 3: GRN generation**
```sql
-- Generate GRN
SELECT generate_goods_return_number(NULL);
-- Result: GRN-25-0001

SELECT generate_goods_return_number(NULL);
-- Result: GRN-25-0002 (sequential)
```

**Test 4: Batch returns**
```sql
-- First component in batch
SELECT * FROM process_supplier_order_return(
  p_supplier_order_id := 100,
  p_quantity := 5,
  p_reason := 'Wrong color',
  p_return_type := 'rejection',
  p_goods_return_number := 'GRN-25-0010',
  p_batch_id := 1
);

-- Second component in same batch (same GRN)
SELECT * FROM process_supplier_order_return(
  p_supplier_order_id := 101,
  p_quantity := 3,
  p_reason := 'Wrong color',
  p_return_type := 'rejection',
  p_goods_return_number := 'GRN-25-0010',
  p_batch_id := 1
);

-- Verify both have same GRN and batch_id
SELECT return_id, goods_return_number, batch_id
FROM supplier_order_returns
WHERE goods_return_number = 'GRN-25-0010';
-- Expected: 2 rows with same GRN and batch_id = 1
```

## Deployment Steps

See: [migrations/README_PHASE1_DEPLOYMENT.md](../../migrations/README_PHASE1_DEPLOYMENT.md)

1. ✅ Apply migration via Supabase SQL Editor
2. ✅ Create `supplier-returns` storage bucket
3. ✅ Configure storage policies
4. ✅ Run verification queries
5. ✅ Test conditional inventory logic
6. ✅ Test GRN generation

## Impact Assessment

### Breaking Changes
⚠️ **RPC behavior changed:** Rejections no longer decrement inventory

**Affected code:**
- Any client code calling `process_supplier_order_return` with `return_type='rejection'` will now see different inventory behavior
- **Action required:** No changes needed - this is the correct behavior

### Non-Breaking Changes
✅ New optional parameters on RPC (backward compatible)
✅ New columns with defaults (existing queries unaffected)
✅ New indexes (improves performance, no breaking changes)

### Database Load
- Sequence operations: Minimal overhead
- New indexes: ~100 bytes per return record
- Storage bucket: Externally managed

## Rollback Plan

See detailed rollback in: [migrations/README_PHASE1_DEPLOYMENT.md](../../migrations/README_PHASE1_DEPLOYMENT.md)

```sql
-- Remove new columns
ALTER TABLE supplier_order_returns
  DROP COLUMN document_url,
  DROP COLUMN signed_document_url,
  -- ... (all new columns)

-- Remove new functions/sequence
DROP FUNCTION generate_goods_return_number(bigint);
DROP SEQUENCE goods_return_number_seq;

-- Restore original RPC from 20250102_create_supplier_returns.sql
```

## Success Metrics

### Phase 1 Completion Criteria
- [x] Migration applied without errors
- [x] All 9 new columns present
- [x] GRN sequence generates unique numbers (GRN-25-0002 through GRN-25-0006 verified)
- [x] Rejection does NOT decrement inventory ⚠️ **CRITICAL** (Test 4: 520 → 520 ✅)
- [x] Later return DOES decrement inventory ⚠️ **CRITICAL** (Test 5: 520 → 517 ✅)
- [x] Storage bucket created and tested
- [x] Policies allow authenticated read/write
- [x] Verification queries pass (All 7 tests passed)
- [x] Batch returns share GRN correctly (Test 7: GRN-25-0022 shared ✅)
- [x] Indexes created for performance

### Test Results Summary (2025-01-15)
- **Test 1:** Schema verification - ✅ All 9 columns present
- **Test 2:** GRN generation - ✅ Sequential unique numbers
- **Test 3:** Test data selection - ✅ Order 73, Component 751
- **Test 4:** Rejection inventory test - ✅ No inventory change (520 → 520)
- **Test 5:** Later return inventory test - ✅ Inventory decremented (520 → 517, restored)
- **Test 6:** Index verification - ✅ All 3 indexes created
- **Test 7:** Batch returns - ✅ GRN sharing works correctly

## Next Steps

### Phase 2: Receiving Inspection UI
- Enhance receiving modal with "Reject Qty" field
- Add rejection reason dropdown
- Display running totals (Ordered / Receiving / Rejecting / Balance)
- Wire up rejection workflow to call RPC with `return_type='rejection'`

### Phase 3: RPC Integration & Testing
- End-to-end testing of conditional inventory logic
- Verify GRN uniqueness and format
- Test batch_id grouping
- Verify total_received calculations

### Remaining Phases
See: [docs/plans/purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)

## Documentation Updates

### Files Created
- [migrations/20250115_enhance_supplier_returns.sql](../../migrations/20250115_enhance_supplier_returns.sql)
- [migrations/README_PHASE1_DEPLOYMENT.md](../../migrations/README_PHASE1_DEPLOYMENT.md)
- [docs/changelogs/supplier-returns-enhancement-phase1-20250115.md](./supplier-returns-enhancement-phase1-20250115.md)

### Files Updated
- [migrations/README.md](../../migrations/README.md) - Added migration entry
- [docs/plans/purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md) - Implementation plan

## References

- **Plan:** [purchase-order-return-communications-plan.md](../plans/purchase-order-return-communications-plan.md)
- **Deployment:** [README_PHASE1_DEPLOYMENT.md](../../migrations/README_PHASE1_DEPLOYMENT.md)
- **Original migration:** [20250102_create_supplier_returns.sql](../../supabase/migrations/20250102_create_supplier_returns.sql)
- **Domain docs:** [purchasing-master.md](../domains/purchasing/purchasing-master.md) (to be updated after feature complete)
