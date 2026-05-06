-- Return manual issuance history with reversal quantities applied.
-- The reversal ledger is intentionally not directly selectable by browser clients,
-- so this RPC exposes only the active remaining manual-issuance rows the UI needs.

CREATE OR REPLACE FUNCTION public.get_manual_stock_issuance_history(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  issuance_id bigint,
  component_id integer,
  component_internal_code text,
  component_description text,
  quantity_issued numeric,
  quantity_reversed numeric,
  quantity_remaining numeric,
  issuance_date timestamp with time zone,
  notes text,
  created_by uuid,
  staff_id integer,
  staff_first_name text,
  staff_last_name text,
  external_reference text,
  issue_category text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer;
BEGIN
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  RETURN QUERY
  WITH reversal_totals AS (
    SELECT
      sr.issuance_id,
      sum(sr.quantity_reversed) AS quantity_reversed
    FROM public.stock_issuance_reversals sr
    GROUP BY sr.issuance_id
  )
  SELECT
    si.issuance_id,
    si.component_id,
    c.internal_code::text AS component_internal_code,
    c.description::text AS component_description,
    si.quantity_issued,
    coalesce(rt.quantity_reversed, 0) AS quantity_reversed,
    si.quantity_issued - coalesce(rt.quantity_reversed, 0) AS quantity_remaining,
    si.issuance_date,
    si.notes::text,
    si.created_by,
    si.staff_id,
    s.first_name::text AS staff_first_name,
    s.last_name::text AS staff_last_name,
    si.external_reference::text,
    si.issue_category::text
  FROM public.stock_issuances si
  JOIN public.components c ON c.component_id = si.component_id
  LEFT JOIN public.staff s ON s.staff_id = si.staff_id
  LEFT JOIN reversal_totals rt ON rt.issuance_id = si.issuance_id
  WHERE si.order_id IS NULL
    AND si.quantity_issued - coalesce(rt.quantity_reversed, 0) > 0
  ORDER BY si.issuance_date DESC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.get_manual_stock_issuance_history(integer)
  IS 'Returns manual stock issuance rows that still have unreversed quantity, including component/staff display fields and reversal totals.';

REVOKE ALL ON FUNCTION public.get_manual_stock_issuance_history(integer)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_manual_stock_issuance_history(integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
