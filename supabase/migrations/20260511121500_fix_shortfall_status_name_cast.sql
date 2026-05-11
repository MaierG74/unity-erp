-- Same-session hotfix to 20260511120000_compute_customer_order_shortfalls.sql.
-- order_statuses.status_name is varchar(50); the function's RETURNS TABLE
-- declared it as text, which triggers `structure of query does not match
-- function result type` at RETURN QUERY. Add an explicit `::TEXT` cast.

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
    s.status_name::TEXT,
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
    AND o.status_id NOT IN (30, 31)
    AND (
      o.delivery_date IS NULL
      OR o.delivery_date <= CURRENT_DATE + (p_horizon_days || ' days')::INTERVAL
    )
    AND cs.real_shortfall > 0
  ORDER BY
    COALESCE(o.delivery_date, CURRENT_DATE + INTERVAL '999 days'),
    o.order_number,
    cs.internal_code;
END;
$$;
