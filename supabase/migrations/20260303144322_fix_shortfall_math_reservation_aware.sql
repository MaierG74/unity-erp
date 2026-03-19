-- Fix shortfall calculations to account for component reservations by other orders.
-- Per-order shortfalls now use (in_stock - reserved_by_others) as available stock.
-- Global shortfalls remain unchanged (reservations redistribute but don't change totals).

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
order_components AS (
    SELECT
        c.component_id,
        SUM(bom.quantity_required * od.quantity) AS order_required
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    JOIN public.components c ON bom.component_id = c.component_id
    WHERE od.order_id = p_order_id
    GROUP BY c.component_id
),
global_requirements AS (
    SELECT
        c.component_id,
        SUM(bom.quantity_required * od.quantity) AS total_required,
        COUNT(DISTINCT od.order_id) AS order_count
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    JOIN public.components c ON bom.component_id = c.component_id
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
    GROUP BY c.component_id
),
order_details AS (
    SELECT
        c.component_id,
        jsonb_agg(
            jsonb_build_object(
                'order_id', od.order_id,
                'quantity', bom.quantity_required * od.quantity,
                'order_date', o.order_date,
                'status', os.status_name
            )
        ) AS order_breakdown
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    JOIN public.components c ON bom.component_id = c.component_id
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND c.component_id IN (SELECT oc_inner.component_id FROM order_components oc_inner)
    GROUP BY c.component_id
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
