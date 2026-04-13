-- Make get_detailed_component_status and reserve_order_components snapshot-aware.
-- Both RPCs now read component requirements from order_details.bom_snapshot (JSONB)
-- when present, falling back to live billofmaterials for older orders without snapshots.
-- This ensures substituted components are correctly tracked for purchasing and reservations.

-- =============================================================================
-- 1. get_detailed_component_status — snapshot-aware
-- =============================================================================

DROP FUNCTION IF EXISTS get_detailed_component_status(INT);

CREATE OR REPLACE FUNCTION get_detailed_component_status(p_order_id INT)
RETURNS TABLE (
    component_id INT,
    internal_code TEXT,
    description TEXT,
    order_required INT,
    total_required INT,
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
-- Extract component requirements for the target order.
-- Prefer bom_snapshot; fall back to live BOM for rows without snapshot.
order_components_raw AS (
    -- From snapshot
    SELECT
        (entry->>'component_id')::INT AS component_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty
    FROM public.order_details od,
         LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE od.order_id = p_order_id
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0

    UNION ALL

    -- Fallback: live BOM for rows without snapshot
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
order_components AS (
    SELECT r.component_id, SUM(r.qty) AS order_required
    FROM order_components_raw r
    GROUP BY r.component_id
),

-- Global requirements across all open orders (snapshot-aware)
global_raw AS (
    -- From snapshot
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

    UNION ALL

    -- Fallback: live BOM
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

-- Per-order breakdown for components relevant to the target order
order_details_raw AS (
    -- From snapshot
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

    UNION ALL

    -- Fallback: live BOM
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
    WHERE odr.component_id IN (SELECT oc_inner.component_id FROM order_components oc_inner)
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
      AND sc.component_id IN (SELECT oc_inner.component_id FROM order_components oc_inner)
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
    oc.order_required::INTEGER,
    gr.total_required::INTEGER,
    gr.order_count,
    cs.in_stock::INTEGER,
    cs.allocated_to_orders::INTEGER AS on_order,
    -- Per-order shortfall: available = in_stock minus what other orders reserved
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0), 0)::NUMERIC AS apparent_shortfall,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0) - cs.allocated_to_orders, 0)::NUMERIC AS real_shortfall,
    -- Global shortfall: reservations just redistribute, total math unchanged
    GREATEST(gr.total_required - cs.in_stock, 0)::NUMERIC AS global_apparent_shortfall,
    GREATEST(gr.total_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall,
    COALESCE(od.order_breakdown::JSON, '[]'::JSON) AS order_breakdown,
    COALESCE(so.on_order_breakdown::JSON, '[]'::JSON) AS on_order_breakdown,
    COALESCE(rt.reserved, 0)::NUMERIC AS reserved_this_order,
    COALESCE(ro.reserved, 0)::NUMERIC AS reserved_by_others
FROM
    order_components oc
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
-- 2. reserve_order_components — snapshot-aware
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reserve_order_components(p_order_id INT, p_org_id UUID)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC)
LANGUAGE plpgsql
AS $function$
BEGIN
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
    -- Snapshot-aware requirements: prefer bom_snapshot, fall back to live BOM
    SELECT cid, SUM(qty)::NUMERIC AS required_qty
    FROM (
      -- From snapshot
      SELECT
        (entry->>'component_id')::INT AS cid,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty
      FROM public.order_details od,
           LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
      WHERE od.order_id = p_order_id
        AND od.bom_snapshot IS NOT NULL
        AND jsonb_typeof(od.bom_snapshot) = 'array'
        AND jsonb_array_length(od.bom_snapshot) > 0

      UNION ALL

      -- Fallback: live BOM
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
