-- Trigger function should never be directly RPC-callable by anon/PUBLIC.
REVOKE EXECUTE ON FUNCTION public.trg_snapshot_order_detail_sections() FROM PUBLIC, anon;
