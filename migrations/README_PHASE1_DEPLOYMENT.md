# Phase 1 Deployment: Schema & Storage Setup

## Prerequisites
- Access to Supabase Dashboard (https://supabase.com/dashboard)
- Project: Unity ERP

## Step 1: Apply Database Migration

**⚠️ IMPORTANT:** The MCP connection is read-only. You must apply this migration through the Supabase SQL Editor.

1. Go to Supabase Dashboard → SQL Editor
2. Open the file: `migrations/20250115_enhance_supplier_returns.sql`
3. Copy the entire contents
4. Paste into SQL Editor
5. Click "Run" to execute

**What this migration does:**
- ✅ Adds 9 new columns to `supplier_order_returns` table
- ✅ Creates `goods_return_number_seq` sequence for GRN generation
- ✅ Creates `generate_goods_return_number()` helper function
- ✅ **Modifies `process_supplier_order_return()` RPC** with conditional inventory logic:
  - `rejection`: Skips inventory decrement (goods never entered stock)
  - `later_return`: Decrements inventory (taking goods out of stock)
- ✅ Adds indexes for performance
- ✅ Grants proper permissions

## Step 2: Create Storage Bucket

**In Supabase Dashboard:**

1. Go to **Storage** → **Buckets**
2. Click **"New bucket"**
3. Configuration:
   - **Name:** `supplier-returns`
   - **Public bucket:** ❌ **OFF** (private bucket)
   - **File size limit:** 10 MB (default)
   - **Allowed MIME types:** `application/pdf,image/png,image/jpeg` (for unsigned PDFs and signed scans)

4. Click **"Create bucket"**

## Step 3: Configure Storage Policies

**In Supabase Dashboard:**

1. Go to **Storage** → **Policies** for `supplier-returns` bucket
2. Click **"New policy"**

### Policy 1: Allow Authenticated Upload

- **Policy name:** `Allow authenticated users to upload`
- **Allowed operation:** INSERT
- **Target roles:** `authenticated`
- **Policy definition:**
```sql
(bucket_id = 'supplier-returns'::text)
```

### Policy 2: Allow Authenticated Read

- **Policy name:** `Allow authenticated users to read`
- **Allowed operation:** SELECT
- **Target roles:** `authenticated`
- **Policy definition:**
```sql
(bucket_id = 'supplier-returns'::text)
```

### Policy 3: Allow Authenticated Update

- **Policy name:** `Allow authenticated users to update`
- **Allowed operation:** UPDATE
- **Target roles:** `authenticated`
- **Policy definition:**
```sql
(bucket_id = 'supplier-returns'::text)
```

### Policy 4: Allow Service Role All Access

- **Policy name:** `Allow service role full access`
- **Allowed operation:** ALL
- **Target roles:** `service_role`
- **Policy definition:**
```sql
(bucket_id = 'supplier-returns'::text)
```

## Step 4: Verify Migration

**Run these queries in SQL Editor to verify:**

```sql
-- Check new columns exist
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'supplier_order_returns'
  AND column_name IN (
    'document_url',
    'signed_document_url',
    'email_status',
    'goods_return_number',
    'batch_id',
    'signature_status'
  )
ORDER BY column_name;

-- Check sequence exists
SELECT * FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'goods_return_number_seq';

-- Test GRN generation
SELECT generate_goods_return_number(NULL);
-- Should return something like: GRN-25-0001

-- Check RPC function signature
SELECT
  proname,
  pronargs,
  proargnames
FROM pg_proc
WHERE proname = 'process_supplier_order_return'
  AND pronamespace = 'public'::regnamespace;
```

## Step 5: Test Conditional Inventory Logic

**⚠️ CRITICAL TEST - Run in staging/test environment first!**

```sql
-- Setup test data (adjust IDs to match your data)
-- Find a supplier order to test with
SELECT
  order_id,
  supplier_component_id,
  order_quantity,
  total_received
FROM supplier_orders
WHERE order_quantity > 0
LIMIT 1;

-- Test 1: Rejection (should NOT decrement inventory)
-- Get current inventory before rejection
SELECT component_id, quantity_on_hand
FROM inventory
WHERE component_id = (
  SELECT component_id
  FROM suppliercomponents
  WHERE supplier_component_id = [YOUR_SUPPLIER_COMPONENT_ID]
);

-- Process rejection
SELECT * FROM process_supplier_order_return(
  p_supplier_order_id := [YOUR_SUPPLIER_ORDER_ID],
  p_quantity := 5,
  p_reason := 'Test rejection - damaged on arrival',
  p_return_type := 'rejection',
  p_signature_status := 'driver'
);

-- Check inventory AFTER rejection (should be UNCHANGED)
SELECT component_id, quantity_on_hand
FROM inventory
WHERE component_id = (
  SELECT component_id
  FROM suppliercomponents
  WHERE supplier_component_id = [YOUR_SUPPLIER_COMPONENT_ID]
);

-- Test 2: Later Return (SHOULD decrement inventory)
-- Get current inventory before return
SELECT component_id, quantity_on_hand
FROM inventory
WHERE component_id = (
  SELECT component_id
  FROM suppliercomponents
  WHERE supplier_component_id = [YOUR_SUPPLIER_COMPONENT_ID]
);

-- Process later return
SELECT * FROM process_supplier_order_return(
  p_supplier_order_id := [YOUR_SUPPLIER_ORDER_ID],
  p_quantity := 3,
  p_reason := 'Test later return - defect found in production',
  p_return_type := 'later_return',
  p_signature_status := 'operator'
);

-- Check inventory AFTER later return (should be DECREMENTED by 3)
SELECT component_id, quantity_on_hand
FROM inventory
WHERE component_id = (
  SELECT component_id
  FROM suppliercomponents
  WHERE supplier_component_id = [YOUR_SUPPLIER_COMPONENT_ID]
);

-- Check return records created
SELECT
  return_id,
  goods_return_number,
  return_type,
  quantity_returned,
  signature_status,
  created_at
FROM supplier_order_returns
WHERE goods_return_number LIKE 'GRN-%'
ORDER BY created_at DESC
LIMIT 5;
```

## Step 6: Verify Storage Bucket

**In Supabase Dashboard:**

1. Go to **Storage** → `supplier-returns` bucket
2. Try manual upload of a test PDF
3. Verify you can view/download it
4. Delete test file

## Success Criteria

✅ Migration applied without errors
✅ All 9 new columns present in `supplier_order_returns`
✅ GRN sequence generates unique numbers
✅ Storage bucket `supplier-returns` created
✅ Storage policies allow authenticated read/write
✅ **CRITICAL:** Rejection does NOT decrement inventory
✅ **CRITICAL:** Later return DOES decrement inventory
✅ GRN numbers generated in format `GRN-25-0001`

## Rollback Plan (If Needed)

```sql
-- Rollback migration (use with caution!)
-- This will remove new columns but preserve existing data

ALTER TABLE public.supplier_order_returns
  DROP COLUMN IF EXISTS document_url,
  DROP COLUMN IF EXISTS signed_document_url,
  DROP COLUMN IF EXISTS document_version,
  DROP COLUMN IF EXISTS email_status,
  DROP COLUMN IF EXISTS email_sent_at,
  DROP COLUMN IF EXISTS email_message_id,
  DROP COLUMN IF EXISTS goods_return_number,
  DROP COLUMN IF EXISTS batch_id,
  DROP COLUMN IF EXISTS signature_status;

DROP FUNCTION IF EXISTS public.generate_goods_return_number(bigint);
DROP SEQUENCE IF EXISTS public.goods_return_number_seq;

-- Restore original RPC function (copy from 20250102_create_supplier_returns.sql)
```

## Next Steps After Phase 1

Once Phase 1 is verified:
- ✅ Proceed to Phase 2: Receiving Inspection UI
- ✅ Update client code to pass new parameters to RPC
- ✅ Build PDF generation components
- ✅ Build email notification system

## Questions or Issues?

If you encounter errors during migration:
1. Check Supabase logs for detailed error messages
2. Verify all foreign key constraints are satisfied
3. Ensure no duplicate GRN numbers exist
4. Contact DBA if rollback is needed
