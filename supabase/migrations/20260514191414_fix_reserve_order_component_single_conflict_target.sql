-- Fix the reserve_order_component_single upsert conflict target.
--
-- In PL/pgSQL functions with OUT parameters, unqualified names in
-- ON CONFLICT (column_name) can collide with returned column names. Use the
-- concrete unique constraint name for the existing (order_id, component_id)
-- key instead.

CREATE OR REPLACE FUNCTION public.reserve_order_component_single(
  p_order_id INT,
  p_component_id INT,
  p_org_id UUID
)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC, qty_available NUMERIC, qty_required NUMERIC)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_fresh boolean;
  v_required NUMERIC;
  v_available NUMERIC;
  v_other_reserved NUMERIC;
  v_reservable NUMERIC;
BEGIN
  SELECT
    CASE
      WHEN o.cutting_plan IS NOT NULL
           AND jsonb_typeof(o.cutting_plan) = 'object'
           AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true
      THEN true
      ELSE false
    END INTO v_plan_fresh
  FROM public.orders o
  WHERE o.order_id = p_order_id;

  SELECT COALESCE(SUM(qty), 0)::NUMERIC
  INTO v_required
  FROM (
    SELECT
      snap.comp_id AS cid,
      snap.qty_req * od.quantity AS qty
    FROM public.order_details od,
         LATERAL (
           SELECT
             COALESCE((entry->>'effective_component_id')::int, (entry->>'component_id')::int) AS comp_id,
             COALESCE((entry->>'effective_quantity_required')::numeric, (entry->>'quantity_required')::numeric) AS qty_req,
             COALESCE((entry->>'is_cutlist_item')::boolean, false) AS is_cutlist_item
           FROM jsonb_array_elements(od.bom_snapshot) AS entry
         ) AS snap
    WHERE od.order_id = p_order_id
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          snap.is_cutlist_item = false
          OR v_plan_fresh IS NOT TRUE
      )

    UNION ALL

    SELECT
      (entry->>'component_id')::INT AS cid,
      (entry->>'quantity')::NUMERIC AS qty
    FROM public.orders o,
         LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE o.order_id = p_order_id
      AND v_plan_fresh = true

    UNION ALL

    SELECT
      bom.component_id AS cid,
      bom.quantity_required * od.quantity AS qty
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE od.order_id = p_order_id
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
  ) raw
  WHERE raw.cid = p_component_id
    AND raw.qty > 0;

  SELECT COALESCE(i.quantity_on_hand, 0)::NUMERIC
  INTO v_available
  FROM public.inventory i
  WHERE i.component_id = p_component_id;

  SELECT COALESCE(SUM(cr.qty_reserved), 0)::NUMERIC
  INTO v_other_reserved
  FROM public.component_reservations cr
  WHERE cr.component_id = p_component_id
    AND cr.order_id <> p_order_id
    AND cr.org_id = p_org_id;

  v_reservable := GREATEST(0, LEAST(v_required, COALESCE(v_available, 0) - COALESCE(v_other_reserved, 0)));

  IF v_reservable > 0 THEN
    INSERT INTO public.component_reservations (order_id, component_id, qty_reserved, org_id)
    VALUES (p_order_id, p_component_id, v_reservable, p_org_id)
    ON CONFLICT ON CONSTRAINT component_reservations_order_id_component_id_key DO UPDATE
      SET qty_reserved = EXCLUDED.qty_reserved,
          org_id       = EXCLUDED.org_id;
  ELSE
    DELETE FROM public.component_reservations cr
    WHERE cr.order_id = p_order_id
      AND cr.component_id = p_component_id
      AND cr.org_id = p_org_id;
  END IF;

  RETURN QUERY
  SELECT
    p_component_id,
    v_reservable,
    COALESCE(v_available, 0),
    COALESCE(v_required, 0);
END;
$function$;

COMMENT ON FUNCTION public.reserve_order_component_single(INT, INT, UUID) IS
  'Per-component reservation. Mirrors reserve_order_components demand calc, filtered to one component. Upserts the reservation idempotently; deletes when nothing reservable. Org-scoped. Spec: docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md';
