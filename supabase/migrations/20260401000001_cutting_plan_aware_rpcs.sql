-- Update get_detailed_component_status to:
-- 1. Return NUMERIC for order_required/total_required (not INT) for fractional edging
-- 2. Split BOM demand into cutlist vs non-cutlist
-- 3. Use cutting_plan.component_overrides for cutlist demand when plan is fresh
-- 4. Fall back to bom_snapshot for cutlist demand when no plan or plan is stale

DROP FUNCTION IF EXISTS get_detailed_component_status(INT);

CREATE OR REPLACE FUNCTION get_detailed_component_status(p_order_id INT)
RETURNS TABLE (
    component_id INT,
    internal_code TEXT,
    description TEXT,
    order_required NUMERIC,
    total_required NUMERIC,
    order_count INT,
    in_stock INT,
    on_order INT,
    apparent_shortfall NUMERIC,
    real_shortfall NUMERIC,
    global_apparent_shortfall NUMERIC,
    global_real_shortfall NUMERIC,
    order_breakdown JSON,
    on_order_breakdown JSON,
    reserved_this_order NUMERIC,
    reserved_by_others NUMERIC
)
LANGUAGE sql
AS $$
WITH
-- Load the cutting plan for the target order (may be NULL)
target_plan AS (
    SELECT
        o.cutting_plan,
        CASE
            WHEN o.cutting_plan IS NOT NULL
                 AND jsonb_typeof(o.cutting_plan) = 'object'
                 AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true
            THEN true
            ELSE false
        END AS plan_is_fresh
    FROM public.orders o
    WHERE o.order_id = p_order_id
),

-- Extract component overrides from the cutting plan (if fresh)
plan_overrides AS (
    SELECT
        (entry->>'component_id')::INT AS component_id,
        (entry->>'quantity')::NUMERIC AS qty
    FROM target_plan tp,
         LATERAL jsonb_array_elements(tp.cutting_plan->'component_overrides') AS entry
    WHERE tp.plan_is_fresh = true
),

-- Set of component IDs that are overridden by the cutting plan
overridden_ids AS (
    SELECT component_id FROM plan_overrides
),

-- NON-CUTLIST demand from bom_snapshot (never overridden)
-- Plus CUTLIST demand when there's no fresh plan
non_cutlist_raw AS (
    -- From snapshot: non-cutlist items always, cutlist items only when no fresh plan
    SELECT
        (entry->>'component_id')::INT AS component_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty
    FROM public.order_details od,
         LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE od.order_id = p_order_id
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          -- Always include non-cutlist items
          COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
          -- Include cutlist items only when plan is NOT fresh
          OR (SELECT NOT plan_is_fresh FROM target_plan)
      )

    UNION ALL

    -- Fallback: live BOM for rows without snapshot (always included)
    SELECT
        bom.component_id,
        bom.quantity_required * od.quantity AS qty
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE od.order_id = p_order_id
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
),

-- Combine: non-cutlist/fallback BOM demand + cutting plan overrides
order_components AS (
    -- Non-cutlist BOM demand (and cutlist demand when no fresh plan)
    SELECT r.component_id, SUM(r.qty) AS order_required
    FROM non_cutlist_raw r
    GROUP BY r.component_id

    UNION ALL

    -- Cutting plan overrides (cutlist demand when plan is fresh)
    SELECT po.component_id, po.qty AS order_required
    FROM plan_overrides po
),

-- Final aggregation: if a component appears in both streams, SUM them
order_components_final AS (
    SELECT oc.component_id, SUM(oc.order_required) AS order_required
    FROM order_components oc
    GROUP BY oc.component_id
),

-- Global requirements across all open orders (cutting-plan-aware)
global_raw AS (
    -- Non-cutlist demand (always from BOM snapshot)
    SELECT
        (entry->>'component_id')::INT AS component_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty,
        od.order_id
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
          OR o.cutting_plan IS NULL
          OR jsonb_typeof(o.cutting_plan) != 'object'
          OR (o.cutting_plan->>'stale')::boolean = true
      )

    UNION ALL

    -- Cutlist demand from cutting plan overrides (for orders with fresh plans)
    SELECT
        (entry->>'component_id')::INT AS component_id,
        (entry->>'quantity')::NUMERIC AS qty,
        o.order_id
    FROM public.orders o
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND o.cutting_plan IS NOT NULL
      AND jsonb_typeof(o.cutting_plan) = 'object'
      AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true

    UNION ALL

    -- Fallback: live BOM for rows without snapshot
    SELECT
        bom.component_id,
        bom.quantity_required * od.quantity AS qty,
        od.order_id
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
),
global_requirements AS (
    SELECT
        gr.component_id,
        SUM(gr.qty) AS total_required,
        COUNT(DISTINCT gr.order_id) AS order_count
    FROM global_raw gr
    GROUP BY gr.component_id
),

-- Per-order breakdown (same cutting-plan-aware logic as global_raw)
order_details_raw AS (
    SELECT
        (entry->>'component_id')::INT AS component_id,
        od.order_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty,
        o.order_date,
        os.status_name
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
          OR o.cutting_plan IS NULL
          OR jsonb_typeof(o.cutting_plan) != 'object'
          OR (o.cutting_plan->>'stale')::boolean = true
      )

    UNION ALL

    SELECT
        (entry->>'component_id')::INT AS component_id,
        o.order_id,
        (entry->>'quantity')::NUMERIC AS qty,
        o.order_date,
        os.status_name
    FROM public.orders o
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND o.cutting_plan IS NOT NULL
      AND jsonb_typeof(o.cutting_plan) = 'object'
      AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true

    UNION ALL

    SELECT
        bom.component_id,
        od.order_id,
        bom.quantity_required * od.quantity AS qty,
        o.order_date,
        os.status_name
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
),
order_details AS (
    SELECT
        odr.component_id,
        jsonb_agg(
            jsonb_build_object(
                'order_id', odr.order_id,
                'quantity', odr.qty,
                'order_date', odr.order_date,
                'status', odr.status_name
            )
        ) AS order_breakdown
    FROM order_details_raw odr
    WHERE odr.component_id IN (SELECT oc.component_id FROM order_components_final oc)
    GROUP BY odr.component_id
),

supplier_orders AS (
    SELECT
        sc.component_id,
        jsonb_agg(
            jsonb_build_object(
                'supplier_order_id', so.order_id,
                'supplier_name', s.name,
                'quantity', so.order_quantity,
                'received', so.total_received,
                'status', sos.status_name,
                'order_date', so.order_date
            )
        ) AS on_order_breakdown
    FROM public.supplier_orders so
    JOIN public.suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
    JOIN public.suppliers s ON sc.supplier_id = s.supplier_id
    JOIN public.supplier_order_statuses sos ON so.status_id = sos.status_id
    WHERE sos.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Received')
      AND sc.component_id IN (SELECT oc.component_id FROM order_components_final oc)
    GROUP BY sc.component_id
),
reservations_this AS (
    SELECT cr.component_id, COALESCE(SUM(cr.qty_reserved), 0) AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id = p_order_id
    GROUP BY cr.component_id
),
reservations_others AS (
    SELECT cr.component_id, COALESCE(SUM(cr.qty_reserved), 0) AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id <> p_order_id
    GROUP BY cr.component_id
)
SELECT
    cs.component_id,
    cs.internal_code,
    cs.description,
    oc.order_required,
    gr.total_required,
    gr.order_count,
    cs.in_stock::INTEGER,
    cs.allocated_to_orders::INTEGER AS on_order,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0), 0)::NUMERIC AS apparent_shortfall,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0) - cs.allocated_to_orders, 0)::NUMERIC AS real_shortfall,
    GREATEST(gr.total_required - cs.in_stock, 0)::NUMERIC AS global_apparent_shortfall,
    GREATEST(gr.total_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall,
    COALESCE(od.order_breakdown::JSON, '[]'::JSON) AS order_breakdown,
    COALESCE(so.on_order_breakdown::JSON, '[]'::JSON) AS on_order_breakdown,
    COALESCE(rt.reserved, 0)::NUMERIC AS reserved_this_order,
    COALESCE(ro.reserved, 0)::NUMERIC AS reserved_by_others
FROM
    order_components_final oc
JOIN
    public.component_status_mv cs ON oc.component_id = cs.component_id
JOIN
    global_requirements gr ON oc.component_id = gr.component_id
LEFT JOIN
    order_details od ON oc.component_id = od.component_id
LEFT JOIN
    supplier_orders so ON oc.component_id = so.component_id
LEFT JOIN
    reservations_this rt ON oc.component_id = rt.component_id
LEFT JOIN
    reservations_others ro ON oc.component_id = ro.component_id;
$$;


-- =============================================================================
-- reserve_order_components — cutting-plan-aware
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reserve_order_components(p_order_id INT, p_org_id UUID)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_plan_fresh boolean;
BEGIN
  -- Check if order has a fresh cutting plan
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

  DELETE FROM public.component_reservations cr
  WHERE cr.order_id = p_order_id AND cr.org_id = p_org_id;

  RETURN QUERY
  INSERT INTO public.component_reservations(order_id, component_id, qty_reserved, org_id)
  SELECT
    p_order_id,
    req.cid,
    GREATEST(0, LEAST(
      req.required_qty,
      COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
    )),
    p_org_id
  FROM (
    SELECT cid, SUM(qty)::NUMERIC AS required_qty
    FROM (
      -- Non-cutlist from snapshot (always included)
      -- Plus cutlist from snapshot when no fresh plan
      SELECT
        (entry->>'component_id')::INT AS cid,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty
      FROM public.order_details od,
           LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
      WHERE od.order_id = p_order_id
        AND od.bom_snapshot IS NOT NULL
        AND jsonb_typeof(od.bom_snapshot) = 'array'
        AND jsonb_array_length(od.bom_snapshot) > 0
        AND (
            COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
            OR v_plan_fresh IS NOT TRUE
        )

      UNION ALL

      -- Cutting plan overrides (when fresh)
      SELECT
        (entry->>'component_id')::INT AS cid,
        (entry->>'quantity')::NUMERIC AS qty
      FROM public.orders o,
           LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
      WHERE o.order_id = p_order_id
        AND v_plan_fresh = true

      UNION ALL

      -- Fallback: live BOM for rows without snapshot
      SELECT
        bom.component_id AS cid,
        (bom.quantity_required * od.quantity) AS qty
      FROM public.order_details od
      JOIN public.billofmaterials bom ON od.product_id = bom.product_id
      WHERE od.order_id = p_order_id
        AND (od.bom_snapshot IS NULL
             OR jsonb_typeof(od.bom_snapshot) != 'array'
             OR jsonb_array_length(od.bom_snapshot) = 0)
    ) raw
    GROUP BY cid
  ) req
  LEFT JOIN (
    SELECT i.component_id AS cid, COALESCE(i.quantity_on_hand, 0)::NUMERIC AS on_hand
    FROM public.inventory i
  ) inv ON inv.cid = req.cid
  LEFT JOIN (
    SELECT cr2.component_id AS cid, SUM(cr2.qty_reserved)::NUMERIC AS reserved
    FROM public.component_reservations cr2
    WHERE cr2.order_id <> p_order_id AND cr2.org_id = p_org_id
    GROUP BY cr2.component_id
  ) other_res ON other_res.cid = req.cid
  WHERE GREATEST(0, LEAST(
    req.required_qty,
    COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
  )) > 0
  RETURNING component_reservations.component_id, component_reservations.qty_reserved;
END;
$function$;
