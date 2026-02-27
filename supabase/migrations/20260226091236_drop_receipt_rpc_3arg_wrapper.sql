-- Hotfix: Drop the 3-arg wrapper that causes PostgREST ambiguity.
-- The 4-arg function with DEFAULT NULL already handles callers that omit p_allocation_receipts.
-- PostgREST cannot disambiguate between two functions with the same first 3 params.
DROP FUNCTION IF EXISTS public.process_supplier_order_receipt(integer, integer, timestamptz);
