-- Create function to get total component requirements across all active orders
CREATE OR REPLACE FUNCTION get_total_component_requirements()
RETURNS TABLE (
    component_id INTEGER,
    total_required INTEGER,
    total_on_order INTEGER,
    total_in_stock INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH 
    -- Get components required for all active orders
    order_requirements AS (
        SELECT 
            c.component_id,
            SUM(bom.quantity_required * od.quantity) AS required_quantity
        FROM 
            order_details od
        JOIN 
            orders o ON od.order_id = o.order_id
        JOIN 
            order_statuses os ON o.status_id = os.status_id
        JOIN 
            billofmaterials bom ON od.product_id = bom.product_id
        JOIN 
            components c ON bom.component_id = c.component_id
        WHERE 
            os.status_name NOT IN ('Completed', 'Cancelled')
        GROUP BY 
            c.component_id
    ),
    -- Get components currently on order
    ordered_components AS (
        SELECT 
            sc.component_id,
            SUM(so.order_quantity - so.total_received) AS pending_quantity
        FROM 
            supplier_orders so
        JOIN 
            supplier_order_statuses sos ON so.status_id = sos.status_id
        JOIN 
            suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
        WHERE 
            sos.status_name NOT IN ('Completed', 'Cancelled')
        GROUP BY 
            sc.component_id
    ),
    -- Get current inventory
    inventory_levels AS (
        SELECT 
            component_id,
            quantity AS in_stock
        FROM 
            inventory
    )
    -- Combine all data
    SELECT 
        c.component_id,
        COALESCE(or.required_quantity, 0) AS total_required,
        COALESCE(oc.pending_quantity, 0) AS total_on_order,
        COALESCE(il.in_stock, 0) AS total_in_stock
    FROM 
        components c
    LEFT JOIN 
        order_requirements or ON c.component_id = or.component_id
    LEFT JOIN 
        ordered_components oc ON c.component_id = oc.component_id
    LEFT JOIN 
        inventory_levels il ON c.component_id = il.component_id;
END;
$$ LANGUAGE plpgsql; 