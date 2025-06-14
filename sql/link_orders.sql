-- Link supplier order 28 (LHP0005) to order ID 89 
-- (we already have a link for order 88)
SELECT link_supplier_order_to_customer_order(
    28,    -- supplier_order_id for LHP0005
    89,    -- order_id for February 2025 order with 20 Apollo Highback chairs
    349,   -- component_id for LHP0005
    20,    -- quantity_for_order: 20 units for the order
    0      -- quantity_for_stock: 0 additional units for stock
);

-- Make sure views are refreshed after this change
SELECT refresh_component_views(); 