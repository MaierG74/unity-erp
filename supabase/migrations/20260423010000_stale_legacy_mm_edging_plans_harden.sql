-- Defensive re-run of the legacy mm-edging stale sweep.
--
-- The original sweep in 20260423000000_stale_legacy_mm_edging_plans.sql
-- ran against our live DB successfully (0 rows affected), but its
-- predicate shape was brittle for environments with malformed JSONB:
--   - (cutting_plan->>'stale')::boolean aborts on non-boolean strings
--     ("yes", "1", "maybe"), which would leave the whole migration un-run.
--   - jsonb_array_elements(cutting_plan->'component_overrides') aborts
--     when component_overrides is NULL or not an array.
--
-- Re-run with JSONB-native comparisons and array-type guards so the
-- same sweep is safe on restored backups, other tenants, or any DB
-- where the cutting_plan shape drifted at some point.

UPDATE public.orders
SET cutting_plan = jsonb_set(cutting_plan, '{stale}', 'true'::jsonb, true)
WHERE cutting_plan IS NOT NULL
  AND jsonb_typeof(cutting_plan) = 'object'
  AND cutting_plan->'stale' IS DISTINCT FROM 'true'::jsonb
  AND jsonb_typeof(cutting_plan->'component_overrides') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cutting_plan->'component_overrides') AS entry
    WHERE entry->>'unit' = 'mm'
      AND entry->>'source' = 'cutlist_edging'
  );
