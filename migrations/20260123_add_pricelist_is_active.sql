-- Add is_active column to supplier_pricelists table
-- This allows marking specific pricelists as "active" to show as thumbnails on the supplier list
-- Historical pricelists can be kept but won't appear in the summary view

ALTER TABLE supplier_pricelists
ADD COLUMN is_active BOOLEAN DEFAULT false;

-- Add an index for filtering active pricelists
CREATE INDEX idx_supplier_pricelists_is_active ON supplier_pricelists (supplier_id, is_active)
WHERE is_active = true;

COMMENT ON COLUMN supplier_pricelists.is_active IS 'When true, this pricelist appears as a thumbnail on the supplier list page';
