-- Stale any cutting plan that still carries legacy unit='mm' edging overrides.
--
-- Prior to the source-side fix (commit 80638df), computeEdging emitted
-- edging entries into cutting_plan.component_overrides with quantity in
-- millimetres and unit='mm'. The cutting-plan-aware purchasing RPCs read
-- quantity directly without honouring the unit field, so 12 m of edging
-- demand landed as 12 000 m of shortfall / reservation / PO demand —
-- a 1000× blow-up on every edged part in every fresh plan.
--
-- The source now emits meters with unit='m'. This migration closes the
-- gap for any plan written before the fix: forcing stale=true means the
-- RPCs bypass the cutlist-demand branch (falling back to bom_snapshot
-- for non-cutlist items) until the user regenerates the plan cleanly.
--
-- Empirical check at the time of writing showed zero affected rows; this
-- migration is a one-shot, idempotent guard against any historic state
-- (other environments, backups restored later, etc.).

UPDATE public.orders
SET cutting_plan = jsonb_set(cutting_plan, '{stale}', 'true'::jsonb, true)
WHERE cutting_plan IS NOT NULL
  AND jsonb_typeof(cutting_plan) = 'object'
  AND (cutting_plan->>'stale')::boolean IS DISTINCT FROM true
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(cutting_plan->'component_overrides') AS entry
    WHERE entry->>'unit' = 'mm'
      AND entry->>'source' = 'cutlist_edging'
  );
