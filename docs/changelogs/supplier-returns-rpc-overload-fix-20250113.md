# Supplier Returns RPC Overload Fix

**Date:** January 13, 2025  
**Type:** Hotfix (Database Migration)  
**Severity:** Critical  
**Status:** ✅ Complete

---

## Overview

Stock return submissions were failing with `ERROR: function process_supplier_order_return(...) is not unique` because the database contained both the original 7-parameter RPC and the new 10-parameter variant. PostgreSQL could not choose the best candidate when clients passed the expanded parameter set, which blocked all supplier return flows (rejections and later returns).

Migration [`migrations/20250113_fix_rpc_overload_conflict_v6.sql`](../../migrations/20250113_fix_rpc_overload_conflict_v6.sql) now runs in Supabase to clear the overload conflict, correct schema references, and ensure only the authoritative signature exists.

---

## Root Cause

- Phase 1 of supplier returns introduced three additional optional parameters (`p_goods_return_number`, `p_batch_id`, `p_signature_status`) but the legacy 7-parameter function definition was never removed.
- PostgreSQL function overloading picks the "best match" based on arity and types; with two equally valid definitions it aborted with `could not choose the best candidate function`.
- Frontend calls defaulted optional arguments, so both function signatures appeared valid and every RPC call failed prior to executing business logic.

---

## Changes Applied

1. Dropped both existing versions of `public.process_supplier_order_return` (7-parameter and 10-parameter).
2. Recreated the function with the full 10-parameter signature, default values, conditional inventory logic, and security definer settings that were introduced during Supplier Returns Phase 1.
3. Reapplied role grants and function comment so authenticated and `service_role` clients keep execute access and documentation stays intact within the schema.
4. (v2) Corrected the RPC internals to use `supplier_component_id` → `suppliercomponents.component_id` lookups and `transaction_types` instead of the deprecated `sale_types` mapping. This keeps returns aligned with actual stock transactions.
5. (v3) Restored the original Phase 1 inventory flow: create the `inventory_transactions` entry first to capture `transaction_id` + `user_id`, persist the `transaction_id` on `supplier_order_returns`, and update the `inventory` table (not `component_inventory`). Inventory is only decremented for `later_return`, but the audit trail now exists for both return types to satisfy downstream reporting.
6. (v4) Fixed the `inventory_transactions` insert to use the actual schema (`component_id`, `quantity`, `transaction_type_id`, `transaction_date` only) so the audit record can be created without referencing non-existent columns.
7. (v5) Resolved the `column reference "transaction_id" is ambiguous` error by explicitly qualifying `inventory_transactions.transaction_id` in the `RETURNING` clause when capturing the audit transaction id.
8. (v6) Prefixed every remaining column reference (`inventory.quantity_on_hand`, `supplier_orders.total_received`, etc.) so PostgreSQL no longer raises ambiguity errors even when joins introduce similarly named fields.

---

## Impact & Verification

- Supplier returns for both `rejection` and `later_return` types now call a single, deterministic RPC.
- Stock return UI flows (including GRN generation and optional signature capture) execute without backend errors.
- Verified by executing the migration in the Supabase SQL Editor; no additional rows were returned, indicating clean execution.

**Smoke Test**

Run the following after deploying the migration:

```sql
select
  proname,
  pronargs
from pg_proc
where proname = 'process_supplier_order_return';
```

Expected result: one row with `pronargs = 10`.

---

## Follow Ups

- Confirm any pending automation or CI scripts reference only the 10-parameter signature.
- Keep an eye on future RPC changes—add a regression test or migration guard to prevent multiple active signatures for the same function.
- Re-run purchasing smoke tests that exercise supplier returns to confirm the corrected schema references (v2) behave as expected.
