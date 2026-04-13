-- Add material_assignments JSONB column to orders.
-- Stores per-part-role board component selections for the cutting plan.
-- Persists independently of cutting_plan (survives plan clear/regeneration).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS material_assignments jsonb;

COMMENT ON COLUMN orders.material_assignments IS
  'Per-part-role board component assignments for cutting plan generation. '
  'Keyed by board_type|part_name|length|width fingerprint. NULL = no assignments.';
