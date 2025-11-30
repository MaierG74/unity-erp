# Database Migrations

This directory contains SQL migration files for the Unity ERP database.

## How to Run Migrations

Migrations should be run through the Supabase Dashboard SQL Editor:

1. Open https://supabase.com/dashboard/project/ttlyfhkrsjjrzxiagzpb/sql
2. Click "New query"
3. Copy the contents of the migration file
4. Paste and execute

## Migration Files

### 20251008_backfill_profiles.sql
**Created:** 2025-10-08
**Purpose:** Populate `public.profiles` for existing users created before the profiles table was introduced.

**What it does:**
- Inserts a profile row for every user in `auth.users` that lacks one, pulling the display name from `raw_user_meta_data->>'full_name'` with email fallback.
- Leaves existing profiles untouched via `ON CONFLICT (id) DO NOTHING`.

**Safe to re-run:** Yes (idempotent insert with conflict handling).

**Verification:** After running the migration, execute:
```sql
SELECT COUNT(*) AS users_with_profiles
FROM auth.users u
INNER JOIN public.profiles p ON u.id = p.id;

SELECT COUNT(*) AS users_without_profiles
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE p.id IS NULL;
```

---

### 20251009_fix_get_product_components.sql
Located at: `db/migrations/20251009_fix_get_product_components.sql`
**Created:** 2025-10-09
**Purpose:** Fix `get_product_components` RPC parameter ambiguity so PostgREST and direct SQL calls honour option-set overrides.

**What it does:**
- Drops the existing `public.get_product_components(integer, jsonb)` function.
- Recreates it with parameter names `_product_id` and `_selected_options` to avoid ambiguous column references.
- Ensures the function returns base BOM rows plus option and option-set overrides when provided selections.

**Safe to re-run:** Yes (drops and recreates the function each time).

**Verification:** After running, execute:
```sql
SELECT * FROM get_product_components(55, '{"HS":"BOWH"}');
```
Expected output includes both the base `96mm Bar handle (Stainless)` component and the Bow handle override row.

---

### 20250930_quote_totals_triggers.sql
**Created:** 2025-09-30
**Purpose:** Automatic totals calculation for quotes system

**What it does:**
- Creates `update_quote_item_total()` function to auto-calculate `quote_items.total = qty * unit_price`
- Creates `update_quote_totals()` function to auto-calculate quote subtotal, VAT amount, and grand total
- Adds triggers on `quote_items` table to automatically maintain totals on INSERT/UPDATE/DELETE
- Fixes all existing quote data with correct total calculations
- Handles VAT rate stored as percentage (15.00 = 15%) and converts to decimal for calculations

**Database objects created:**
- Function: `update_quote_item_total()`
- Function: `update_quote_totals()`
- Trigger: `quote_item_total_trigger` on `quote_items`
- Trigger: `quote_items_total_update_trigger` on `quote_items`

**Safe to re-run:** Yes (uses `CREATE OR REPLACE` and `DROP TRIGGER IF EXISTS`)

**Rollback:** To rollback, drop the triggers and functions:
```sql
DROP TRIGGER IF EXISTS quote_item_total_trigger ON quote_items;
DROP TRIGGER IF EXISTS quote_items_total_update_trigger ON quote_items;
DROP FUNCTION IF EXISTS update_quote_item_total();
DROP FUNCTION IF EXISTS update_quote_totals();
```

---

### fix-supplier-order-statuses.sql
**Created:** 2025-01-10
**Purpose:** Correct supplier order statuses to match actual received quantities

**What it does:**
- Updates all `supplier_orders` where status doesn't match the actual received quantity
- Sets status to "Partially Received" for orders with `0 < total_received < order_quantity`
- Sets status to "Fully Received" for orders with `total_received >= order_quantity`
- Provides comprehensive reporting showing which orders were fixed
- Includes verification query to confirm all statuses are correct

**Safe to re-run:** Yes (idempotent - only updates incorrect statuses)

**Background:** This migration fixes a data consistency issue where supplier orders had incorrect statuses due to:
1. Returns not updating status properly (function only handled "Fully Received" → "Partially Received", not "Completed" → "Partially Received")
2. Legacy data with "Completed" status instead of proper receiving statuses
3. Some orders not getting status updates during receiving workflow

**Orders fixed:** 3 orders (64, 65, 73) updated from incorrect statuses to "Partially Received"

**Verification:** After running, execute:
```sql
SELECT
  so.order_id,
  po.q_number,
  so.order_quantity,
  so.total_received,
  sos.status_name,
  CASE
    WHEN so.total_received >= so.order_quantity THEN 'Fully Received'
    WHEN so.total_received > 0 THEN 'Partially Received'
    ELSE 'Open/Approved'
  END as expected_status
FROM supplier_orders so
LEFT JOIN purchase_orders po ON so.purchase_order_id = po.purchase_order_id
LEFT JOIN supplier_order_statuses sos ON so.status_id = sos.status_id
WHERE so.total_received IS NOT NULL
  AND (
    (so.total_received >= so.order_quantity AND sos.status_name != 'Fully Received')
    OR
    (so.total_received > 0 AND so.total_received < so.order_quantity
     AND sos.status_name != 'Partially Received')
  );
```
Expected: 0 rows (all statuses correct)

**Related Documentation:**
- See [docs/changelogs/on-order-calculation-fix-20250110.md](../docs/changelogs/on-order-calculation-fix-20250110.md) for full context
- See [docs/plans/fix-on-order-calculation-inner-join.md](../docs/plans/fix-on-order-calculation-inner-join.md) for the related query fix

---

### 20250115_enhance_supplier_returns.sql
**Created:** 2025-01-15
**Purpose:** Enhance supplier returns with document generation, email tracking, GRN numbering, and conditional inventory logic

**What it does:**
- Adds 9 new columns to `supplier_order_returns`: document URLs, email status, GRN, batch ID, signature status
- Creates `goods_return_number_seq` sequence for atomic GRN generation
- Creates `generate_goods_return_number()` helper function (format: `GRN-25-0001`)
- **Modifies `process_supplier_order_return()` RPC** with conditional inventory logic:
  - **Rejection (at gate):** Does NOT decrement inventory (goods never entered stock)
  - **Later return (from stock):** DOES decrement inventory (taking goods out)
- Adds indexes for performance on new columns
- Grants proper permissions to authenticated users

**Database objects created/modified:**
- Columns: `document_url`, `signed_document_url`, `document_version`, `email_status`, `email_sent_at`, `email_message_id`, `goods_return_number`, `batch_id`, `signature_status`
- Sequence: `goods_return_number_seq`
- Function: `generate_goods_return_number(bigint)` (new)
- Function: `process_supplier_order_return(...)` (modified with 3 new parameters)
- Indexes: `idx_supplier_order_returns_goods_return_number`, `idx_supplier_order_returns_batch_id`, `idx_supplier_order_returns_email_status`

**Critical behavior change:**
⚠️ **BREAKING CHANGE:** The RPC now behaves differently based on `return_type`:
- **Before:** All returns decremented inventory regardless of type
- **After:** Only `later_return` decrements inventory; `rejection` skips inventory decrement

**Safe to re-run:** Yes (uses `CREATE OR REPLACE` for functions, `ADD COLUMN IF NOT EXISTS` for columns)

**Storage setup required:**
After running this migration, create storage bucket `supplier-returns` in Supabase Dashboard (see `README_PHASE1_DEPLOYMENT.md`)

**Verification:** See detailed test queries in `README_PHASE1_DEPLOYMENT.md`

**Related documentation:**
- [docs/plans/purchase-order-return-communications-plan.md](../docs/plans/purchase-order-return-communications-plan.md) - Full feature plan
- [migrations/README_PHASE1_DEPLOYMENT.md](./README_PHASE1_DEPLOYMENT.md) - Deployment guide with testing procedures

**Rollback:** See rollback instructions in `README_PHASE1_DEPLOYMENT.md`

---

## Migration Naming Convention

Migrations are named: `YYYYMMDD_descriptive_name.sql`

Example: `20250930_quote_totals_triggers.sql`
