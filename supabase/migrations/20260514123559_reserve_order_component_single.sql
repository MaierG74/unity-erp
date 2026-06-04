-- Per-component reservation RPC - snapshot/effective-field/cutting-plan-aware,
-- mirrors the demand calculation from reserve_order_components and filters to
-- one component, then upserts the reservation idempotently.
--
-- Design constraints baked in:
--   1. CHECK (qty_reserved > 0) on component_reservations means we MUST branch
--      on v_reservable > 0 - naive upsert of zero would trip the CHECK.
--   2. SET search_path keeps the function out of the "role mutable search_path"
--      advisor that the existing reserve_order_components currently inherits.
--   3. DELETE branch and UPDATE branch are both org-scoped - never cross-org.
--
-- Spec: docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md

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
  -- Mirror the fresh-plan check from reserve_order_components.
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

  -- Demand for THIS component on THIS order. Mirrors the existing
  -- reserve_order_components demand calculation exactly (snapshot effective
  -- fields, fresh-plan cutlist overrides, live-BOM fallback for snapshot-less
  -- rows) then filters the result to p_component_id.
  SELECT COALESCE(SUM(qty), 0)::NUMERIC
  INTO v_required
  FROM (
    -- Non-cutlist demand from bom_snapshot (always);
    -- cutlist demand from snapshot ONLY when there is no fresh cutting plan.
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

    -- Fresh cutting-plan component overrides (cutlist demand when plan is fresh).
    SELECT
      (entry->>'component_id')::INT AS cid,
      (entry->>'quantity')::NUMERIC AS qty
    FROM public.orders o,
         LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE o.order_id = p_order_id
      AND v_plan_fresh = true

    UNION ALL

    -- Fallback: live BOM for any order_details row that lacks a usable snapshot.
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
  WHERE cid = p_component_id
    AND qty > 0;

  -- Inventory on hand.
  SELECT COALESCE(quantity_on_hand, 0)::NUMERIC
  INTO v_available
  FROM public.inventory
  WHERE component_id = p_component_id;

  -- Other orders' active reservations for this component (this org only).
  SELECT COALESCE(SUM(qty_reserved), 0)::NUMERIC
  INTO v_other_reserved
  FROM public.component_reservations
  WHERE component_id = p_component_id
    AND order_id <> p_order_id
    AND org_id = p_org_id;

  v_reservable := GREATEST(0, LEAST(v_required, COALESCE(v_available, 0) - COALESCE(v_other_reserved, 0)));

  IF v_reservable > 0 THEN
    INSERT INTO public.component_reservations (order_id, component_id, qty_reserved, org_id)
    VALUES (p_order_id, p_component_id, v_reservable, p_org_id)
    ON CONFLICT (order_id, component_id) DO UPDATE
      SET qty_reserved = EXCLUDED.qty_reserved,
          org_id       = EXCLUDED.org_id;
  ELSE
    -- Nothing reservable. Org-scoped DELETE so we never touch cross-org rows
    -- even if a future bug ever calls this function with a wrong org_id.
    DELETE FROM public.component_reservations
    WHERE order_id = p_order_id
      AND component_id = p_component_id
      AND org_id = p_org_id;
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
