-- Migration: Create product_cutlist_groups table
-- Description: Stores cutlist groups for products with board types, materials, and parts
-- Date: 2026-01-22

-- Create the product_cutlist_groups table
CREATE TABLE IF NOT EXISTS product_cutlist_groups (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Unnamed Group',
  board_type TEXT NOT NULL DEFAULT '16mm' CHECK (board_type IN ('16mm', '32mm-both', '32mm-backer')),
  primary_material_id INT REFERENCES components(component_id) ON DELETE SET NULL,
  primary_material_name TEXT,
  backer_material_id INT REFERENCES components(component_id) ON DELETE SET NULL,
  backer_material_name TEXT,
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups by product
CREATE INDEX IF NOT EXISTS idx_product_cutlist_groups_product_id
  ON product_cutlist_groups(product_id);

-- Create index for sort order
CREATE INDEX IF NOT EXISTS idx_product_cutlist_groups_sort_order
  ON product_cutlist_groups(product_id, sort_order);

-- Add comment describing the table
COMMENT ON TABLE product_cutlist_groups IS 'Stores cutlist groups for products, defining board lamination types and parts for sheet nesting calculations';

-- Add column comments
COMMENT ON COLUMN product_cutlist_groups.board_type IS 'Board lamination type: 16mm (single), 32mm-both (same material both sides), 32mm-backer (different backer material)';
COMMENT ON COLUMN product_cutlist_groups.parts IS 'JSON array of parts: [{id, name, length_mm, width_mm, quantity, grain, band_edges: {top, right, bottom, left}, material_label}]';

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_product_cutlist_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_product_cutlist_groups_updated_at ON product_cutlist_groups;
CREATE TRIGGER trigger_update_product_cutlist_groups_updated_at
  BEFORE UPDATE ON product_cutlist_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_product_cutlist_groups_updated_at();

-- Enable RLS
ALTER TABLE product_cutlist_groups ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (allow all authenticated users for now)
DROP POLICY IF EXISTS "Allow authenticated users to view cutlist groups" ON product_cutlist_groups;
CREATE POLICY "Allow authenticated users to view cutlist groups"
  ON product_cutlist_groups
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert cutlist groups" ON product_cutlist_groups;
CREATE POLICY "Allow authenticated users to insert cutlist groups"
  ON product_cutlist_groups
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update cutlist groups" ON product_cutlist_groups;
CREATE POLICY "Allow authenticated users to update cutlist groups"
  ON product_cutlist_groups
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete cutlist groups" ON product_cutlist_groups;
CREATE POLICY "Allow authenticated users to delete cutlist groups"
  ON product_cutlist_groups
  FOR DELETE
  TO authenticated
  USING (true);
