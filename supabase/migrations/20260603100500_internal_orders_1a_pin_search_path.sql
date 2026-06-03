-- Phase 1A (6/6): pin search_path on the trigger/helper functions added in this phase
-- to clear function_search_path_mutable advisor warnings (zero-new-warnings bar).
ALTER FUNCTION public.enforce_order_type_immutable()            SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_order_detail_counter_type()       SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_order_delivery_notes()               SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_order_delivery_note_items()          SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_stock_receipts()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_stock_receipt_items()                SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_matches_product_org()                SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_order_detail_required_sections()     SET search_path = public, pg_temp;
ALTER FUNCTION public.xorg_order_status_events()                SET search_path = public, pg_temp;
