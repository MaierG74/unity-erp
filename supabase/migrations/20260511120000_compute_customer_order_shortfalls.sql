-- Customer-order component shortfall scan (capability 1, plan §4.1).
-- One row per (open order × component) where reservation-aware shortfall > 0.
--
-- This is the read RPC behind Sam's daily shortfall scan. Sam's runtime
-- (OpenClaw) calls it via the agent-closure-rpc Edge Function with
-- action_kind='read'. For each row returned, Sam then calls
-- register_closure_item via the same wrapper to open a closure_item with
-- source_fingerprint = 'customer_order_component_shortfall:<order_id>:<component_id>'.
-- The partial-unique on closure_items(active source_type+fingerprint) means
-- replayed scans don't duplicate; resolved shortfalls auto-close out of band.
--
-- The reservation-aware math is delegated to the existing
-- public.get_detailed_component_status(p_order_id) function — that's already
-- the canonical "real_shortfall" computation everywhere else in the app, and
-- using it keeps the scan consistent with what the order page shows.

CREATE OR REPLACE FUNCTION public.compute_customer_order_shortfalls(
  p_org_id        UUID,
  p_horizon_days  INTEGER DEFAULT 14
)
RETURNS TABLE (
  order_id              INTEGER,
  order_number          TEXT,
  delivery_date         DATE,
  status_name           TEXT,
  component_id          INTEGER,
  internal_code         TEXT,
  description           TEXT,
  order_required        NUMERIC,
  in_stock              NUMERIC,
  on_order              NUMERIC,
  reserved_this_order   NUMERIC,
  reserved_by_others    NUMERIC,
  real_shortfall        NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;
  IF p_horizon_days IS NULL OR p_horizon_days < 0 THEN
    RAISE EXCEPTION 'p_horizon_days must be a non-negative integer';
  END IF;

  RETURN QUERY
  SELECT
    o.order_id,
    o.order_number,
    o.delivery_date,
    s.status_name,
    cs.component_id,
    cs.internal_code,
    cs.description,
    cs.order_required,
    cs.in_stock::NUMERIC,
    cs.on_order::NUMERIC,
    cs.reserved_this_order,
    cs.reserved_by_others,
    cs.real_shortfall
  FROM public.orders o
  JOIN public.order_statuses s ON s.status_id = o.status_id
  CROSS JOIN LATERAL public.get_detailed_component_status(o.order_id) cs
  WHERE o.org_id = p_org_id
    AND o.status_id NOT IN (30, 31)  -- Completed, Cancelled
    AND (
      o.delivery_date IS NULL
      OR o.delivery_date <= CURRENT_DATE + (p_horizon_days || ' days')::INTERVAL
    )
    AND cs.real_shortfall > 0
  ORDER BY
    -- Most urgent first; null delivery_date sinks to the bottom.
    COALESCE(o.delivery_date, CURRENT_DATE + INTERVAL '999 days'),
    o.order_number,
    cs.internal_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_customer_order_shortfalls(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.compute_customer_order_shortfalls(UUID, INTEGER) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.compute_customer_order_shortfalls(UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION public.compute_customer_order_shortfalls(UUID, INTEGER) IS
  'Returns one row per (open customer order × component) with reservation-aware real_shortfall > 0, inside p_horizon_days. Delegates the per-order math to get_detailed_component_status. Read-only; SECURITY DEFINER with EXECUTE granted only to service_role (called via agent-closure-rpc Edge Function). See plan §4.1.';
