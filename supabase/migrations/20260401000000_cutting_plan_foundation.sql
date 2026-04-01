-- 1. Add cutting_plan column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cutting_plan jsonb;

COMMENT ON COLUMN orders.cutting_plan IS
  'Optimized cutting plan from order-level nesting. NULL = no plan generated.
   When present and not stale, purchasing RPCs use component_overrides
   instead of naive BOM quantities for cutlist materials.';

-- 2. Centralized stale-marking function (idempotent, race-safe)
CREATE OR REPLACE FUNCTION mark_cutting_plan_stale(p_order_id INT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders
  SET cutting_plan = jsonb_set(cutting_plan, '{stale}', 'true'::jsonb)
  WHERE order_id = p_order_id
    AND cutting_plan IS NOT NULL
    AND (cutting_plan->>'stale')::boolean IS DISTINCT FROM true;
END;
$$;
