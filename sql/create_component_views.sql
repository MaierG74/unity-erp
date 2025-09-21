-- First create a function to refresh all component-related views
CREATE OR REPLACE FUNCTION refresh_component_views() 
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW component_requirements_mv;
  REFRESH MATERIALIZED VIEW component_allocation_mv;
  REFRESH MATERIALIZED VIEW component_status_mv;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for component requirements per order
DROP MATERIALIZED VIEW IF EXISTS component_requirements_mv;
CREATE MATERIALIZED VIEW component_requirements_mv AS
SELECT 
    c.component_id,
    c.internal_code,
    c.description,
    od.order_id,
    SUM(bom.quantity_required * od.quantity) AS quantity_required
FROM 
    order_details od
JOIN 
    billofmaterials bom ON od.product_id = bom.product_id
JOIN 
    components c ON bom.component_id = c.component_id
GROUP BY 
    c.component_id, c.internal_code, c.description, od.order_id;

-- Create materialized view for component allocations from supplier orders
DROP MATERIALIZED VIEW IF EXISTS component_allocation_mv;
CREATE MATERIALIZED VIEW component_allocation_mv AS
SELECT 
    sc.component_id,
    SUM(
        CASE 
            WHEN sos.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Received') 
            THEN so.order_quantity - COALESCE(so.total_received, 0)
            ELSE 0
        END
    ) AS allocated_to_orders
FROM 
    supplier_orders so
JOIN 
    suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
JOIN 
    supplier_order_statuses sos ON so.status_id = sos.status_id
GROUP BY 
    sc.component_id;

-- Create the main component status view combining inventory and allocations
DROP MATERIALIZED VIEW IF EXISTS component_status_mv;
CREATE MATERIALIZED VIEW component_status_mv AS
SELECT 
    c.component_id,
    c.internal_code,
    c.description,
    COALESCE(i.quantity_on_hand, 0) AS in_stock,
    COALESCE(ca.allocated_to_orders, 0) AS allocated_to_orders
FROM 
    components c
LEFT JOIN 
    inventory i ON c.component_id = i.component_id
LEFT JOIN 
    component_allocation_mv ca ON c.component_id = ca.component_id;

-- Create a function to get component status for a specific order
CREATE OR REPLACE FUNCTION get_order_component_status(p_order_id INT)
RETURNS TABLE (
    component_id INT,
    internal_code TEXT,
    description TEXT,
    order_required INT,
    in_stock INT,
    on_order INT,
    apparent_shortfall NUMERIC,
    real_shortfall NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH order_components AS (
        SELECT 
            c.component_id,
            SUM(bom.quantity_required * od.quantity) AS order_required
        FROM 
            public.order_details od
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            od.order_id = p_order_id
        GROUP BY 
            c.component_id
    )
    SELECT 
        cs.component_id,
        cs.internal_code,
        cs.description,
        oc.order_required::INTEGER,
        cs.in_stock::INTEGER,
        cs.allocated_to_orders::INTEGER AS on_order,
        GREATEST(oc.order_required - cs.in_stock, 0)::NUMERIC AS apparent_shortfall,
        GREATEST(oc.order_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS real_shortfall
    FROM 
        order_components oc
    JOIN 
        public.component_status_mv cs ON oc.component_id = cs.component_id;
END;
$$ LANGUAGE plpgsql;

-- Create a function to get total component requirements across all open orders
CREATE OR REPLACE FUNCTION get_global_component_requirements()
RETURNS TABLE (
    component_id INT,
    internal_code TEXT,
    description TEXT,
    total_required INT,
    order_count INT,
    in_stock INT,
    on_order INT,
    global_apparent_shortfall NUMERIC,
    global_real_shortfall NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH global_requirements AS (
        SELECT 
            c.component_id,
            SUM(bom.quantity_required * od.quantity) AS total_required,
            COUNT(DISTINCT od.order_id) AS order_count
        FROM 
            public.order_details od
        JOIN 
            public.orders o ON od.order_id = o.order_id
        JOIN 
            public.order_statuses os ON o.status_id = os.status_id
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            -- Only include open/active orders, not completed or cancelled
            os.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Fulfilled')
        GROUP BY 
            c.component_id
    )
    SELECT 
        cs.component_id,
        cs.internal_code,
        cs.description,
        gr.total_required::INTEGER,
        gr.order_count,
        cs.in_stock::INTEGER,
        cs.allocated_to_orders::INTEGER AS on_order,
        GREATEST(gr.total_required - cs.in_stock, 0)::NUMERIC AS global_apparent_shortfall,
        GREATEST(gr.total_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall
    FROM 
        global_requirements gr
    JOIN 
        public.component_status_mv cs ON gr.component_id = cs.component_id;
END;
$$ LANGUAGE plpgsql;

-- Create a combined function that returns both order-specific and global component status
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
    on_order_breakdown JSON
) AS $$
BEGIN
    RETURN QUERY
    WITH 
    -- Get components needed for this specific order
    order_components AS (
        SELECT 
            c.component_id,
            SUM(bom.quantity_required * od.quantity) AS order_required
        FROM 
            public.order_details od
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            od.order_id = p_order_id
        GROUP BY 
            c.component_id
    ),
    -- Get total requirements across all open orders
    global_requirements AS (
        SELECT 
            c.component_id,
            SUM(bom.quantity_required * od.quantity) AS total_required,
            COUNT(DISTINCT od.order_id) AS order_count
        FROM 
            public.order_details od
        JOIN 
            public.orders o ON od.order_id = o.order_id
        JOIN 
            public.order_statuses os ON o.status_id = os.status_id
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            -- Only include open/active orders, not completed or cancelled
            os.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Fulfilled')
        GROUP BY 
            c.component_id
    ),
    -- Get breakdown of which orders need this component
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
        FROM 
            public.order_details od
        JOIN 
            public.orders o ON od.order_id = o.order_id
        JOIN 
            public.order_statuses os ON o.status_id = os.status_id
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            -- Only include open/active orders, not completed or cancelled
            os.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Fulfilled')
            AND c.component_id IN (SELECT component_id FROM order_components)
        GROUP BY 
            c.component_id
    ),
    -- Get breakdown of supplier orders for these components
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
        FROM 
            public.supplier_orders so
        JOIN 
            public.suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
        JOIN 
            public.suppliers s ON sc.supplier_id = s.supplier_id
        JOIN 
            public.supplier_order_statuses sos ON so.status_id = sos.status_id
        WHERE 
            -- Only include open/active orders
            sos.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Received')
            AND sc.component_id IN (SELECT component_id FROM order_components)
        GROUP BY 
            sc.component_id
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
        GREATEST(oc.order_required - cs.in_stock, 0)::NUMERIC AS apparent_shortfall,
        GREATEST(oc.order_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS real_shortfall,
        GREATEST(gr.total_required - cs.in_stock, 0)::NUMERIC AS global_apparent_shortfall,
        GREATEST(gr.total_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall,
        COALESCE(od.order_breakdown::JSON, '[]'::JSON) AS order_breakdown,
        COALESCE(so.on_order_breakdown::JSON, '[]'::JSON) AS on_order_breakdown
    FROM 
        order_components oc
    JOIN 
        public.component_status_mv cs ON oc.component_id = cs.component_id
    JOIN
        global_requirements gr ON oc.component_id = gr.component_id
    LEFT JOIN
        order_details od ON oc.component_id = od.component_id
    LEFT JOIN
        supplier_orders so ON oc.component_id = so.component_id;
END;
$$ LANGUAGE plpgsql;

-- Create a function to link supplier orders to customer orders
CREATE OR REPLACE FUNCTION link_supplier_order_to_customer_order(
    p_supplier_order_id INT,
    p_order_id INT,
    p_component_id INT,
    p_quantity_for_order INT,
    p_quantity_for_stock INT DEFAULT 0
) RETURNS VOID AS $$
BEGIN
    INSERT INTO supplier_order_customer_orders (
        supplier_order_id, 
        order_id, 
        component_id, 
        quantity_for_order, 
        quantity_for_stock
    ) VALUES (
        p_supplier_order_id,
        p_order_id,
        p_component_id,
        p_quantity_for_order,
        p_quantity_for_stock
    )
    ON CONFLICT (supplier_order_id, order_id, component_id)
    DO UPDATE SET
        quantity_for_order = p_quantity_for_order,
        quantity_for_stock = p_quantity_for_stock;
END;
$$ LANGUAGE plpgsql;

-- Initial refresh of the views
SELECT refresh_component_views();

-- Function to get global component requirements across all orders
CREATE OR REPLACE FUNCTION get_all_component_requirements()
RETURNS SETOF JSONB AS $$
WITH 
    -- Get all open orders
    open_orders AS (
        SELECT 
            o.order_id 
        FROM 
            public.orders o
        JOIN 
            public.order_statuses os ON o.status_id = os.status_id
        WHERE 
            os.status_name IN ('Open', 'In Progress', 'Pending')
    ),
    
    -- Get all component requirements in all open orders
    all_order_components AS (
        SELECT 
            c.component_id,
            c.internal_code,
            c.description,
            SUM(od.quantity * bom.quantity_required) AS total_required,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM 
            public.orders o
        JOIN 
            public.order_details od ON o.order_id = od.order_id
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            o.order_id IN (SELECT order_id FROM open_orders)
        GROUP BY 
            c.component_id, c.internal_code, c.description
    ),
    
    -- Get order breakdown for each component
    order_details AS (
        SELECT 
            c.component_id,
            jsonb_agg(
                jsonb_build_object(
                    'order_id', o.order_id,
                    'quantity', (od.quantity * bom.quantity_required)::INTEGER,
                    'order_date', o.created_at,
                    'status', os.status_name
                )
            ) AS order_breakdown
        FROM 
            public.orders o
        JOIN 
            public.order_statuses os ON o.status_id = os.status_id
        JOIN 
            public.order_details od ON o.order_id = od.order_id
        JOIN 
            public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            public.components c ON bom.component_id = c.component_id
        WHERE 
            o.order_id IN (SELECT order_id FROM open_orders)
        GROUP BY 
            c.component_id
    )
    
    SELECT 
        jsonb_build_object(
            'component_id', aoc.component_id,
            'internal_code', COALESCE(cs.internal_code, aoc.internal_code),
            'description', COALESCE(cs.description, aoc.description),
            'total_required', aoc.total_required::INTEGER,
            'order_count', aoc.order_count,
            'in_stock', COALESCE(cs.in_stock, 0)::INTEGER,
            'allocated_to_orders', COALESCE(cs.allocated_to_orders, 0)::INTEGER,
            'global_apparent_shortfall', GREATEST(aoc.total_required - COALESCE(cs.in_stock, 0), 0)::INTEGER,
            'global_real_shortfall', GREATEST(aoc.total_required - COALESCE(cs.in_stock, 0) - COALESCE(cs.allocated_to_orders, 0), 0)::INTEGER,
            'order_breakdown', COALESCE(od.order_breakdown, '[]'::JSONB)
        )
    FROM 
        all_order_components aoc
    LEFT JOIN 
        public.component_status_mv cs ON aoc.component_id = cs.component_id
    LEFT JOIN 
        order_details od ON aoc.component_id = od.component_id;
$$ LANGUAGE SQL; 
