-- ============================================================================
-- Hotfix for 20260604120000_picking_list_reservation_wiring
-- ----------------------------------------------------------------------------
-- The CREATE OR REPLACE VIEW statements in the wiring migration were written
-- without a `WITH (security_invoker = true)` clause, which reset these two views
-- to the Postgres default (SECURITY DEFINER). A DEFINER view bypasses RLS on the
-- org-scoped base tables (inventory, components), so a caller could read another
-- org's inventory — including the new quantity_reserved/quantity_available — via
-- the view. The sibling inventory views (inventory_transactions_enriched,
-- product_inventory_transactions_with_balance) are correctly security_invoker.
-- Restore that here so RLS is enforced on these availability surfaces and the
-- security_definer_view advisor finding clears.
-- ============================================================================
ALTER VIEW public.v_inventory_with_components SET (security_invoker = true);
ALTER VIEW public.v_inventory_shortages SET (security_invoker = true);
