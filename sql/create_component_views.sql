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