-- Add suppliers if they don't exist
INSERT INTO suppliers (name, contact_info)
SELECT 'Acme Supplies', 'contact@acme-supplies.com'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Acme Supplies');

INSERT INTO suppliers (name, contact_info)
SELECT 'TechParts Inc', 'sales@techparts.com'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'TechParts Inc');

INSERT INTO suppliers (name, contact_info)
SELECT 'Global Components', 'info@globalcomponents.com'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'Global Components');

-- Get the component_id for GTYPIST
WITH component AS (
  SELECT component_id FROM components WHERE internal_code = 'GTYPIST'
)
-- Delete any existing supplier components for GTYPIST to avoid duplicates
DELETE FROM suppliercomponents
WHERE component_id = (SELECT component_id FROM component);

-- Add supplier components for GTYPIST
INSERT INTO suppliercomponents (component_id, supplier_id, supplier_code, price, lead_time, min_order_quantity, description)
SELECT 
  c.component_id,
  s.supplier_id,
  'SUP-' || s.supplier_id || '-' || c.internal_code,
  CASE 
    WHEN s.name = 'Acme Supplies' THEN 100.00
    WHEN s.name = 'TechParts Inc' THEN 110.00
    WHEN s.name = 'Global Components' THEN 120.00
    ELSE 100.00
  END as price,
  CASE 
    WHEN s.name = 'Acme Supplies' THEN 7
    WHEN s.name = 'TechParts Inc' THEN 9
    WHEN s.name = 'Global Components' THEN 11
    ELSE 7
  END as lead_time,
  5 as min_order_quantity,
  c.internal_code || ' from ' || s.name as description
FROM components c, suppliers s
WHERE c.internal_code = 'GTYPIST';

-- Verify the inserted data
SELECT 
  sc.supplier_component_id,
  c.internal_code as component_code,
  s.name as supplier_name,
  sc.price,
  sc.lead_time,
  sc.supplier_code
FROM suppliercomponents sc
JOIN components c ON sc.component_id = c.component_id
JOIN suppliers s ON sc.supplier_id = s.supplier_id
WHERE c.internal_code = 'GTYPIST'
ORDER BY sc.price; 