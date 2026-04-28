-- Read-only regression checks for the BOM snapshot extraction used by
-- get_detailed_component_status() and reserve_order_components().
--
-- Run with:
--   psql "$DATABASE_URL" -f supabase/tests/20260428_snapshot_effective_field_rpcs.sql

WITH cases AS (
  SELECT
    'parity_no_swap'::text AS case_name,
    '[{"component_id":10,"quantity_required":2}]'::jsonb AS snapshot,
    10::int AS expected_component_id,
    2::numeric AS expected_quantity
  UNION ALL
  SELECT
    'alternative_swap',
    '[{"component_id":10,"quantity_required":2,"effective_component_id":11,"effective_quantity_required":3}]'::jsonb,
    11,
    3
  UNION ALL
  SELECT
    'removed_swap',
    '[{"component_id":10,"quantity_required":2,"effective_component_id":10,"effective_quantity_required":0,"is_removed":true}]'::jsonb,
    10,
    0
),
extracted AS (
  SELECT
    c.case_name,
    COALESCE((entry->>'effective_component_id')::int, (entry->>'component_id')::int) AS component_id,
    COALESCE((entry->>'effective_quantity_required')::numeric, (entry->>'quantity_required')::numeric) AS quantity_required
  FROM cases c
  CROSS JOIN LATERAL jsonb_array_elements(c.snapshot) AS entry
),
assertions AS (
  SELECT
    c.case_name,
    e.component_id = c.expected_component_id AS component_ok,
    e.quantity_required = c.expected_quantity AS quantity_ok,
    CASE WHEN e.quantity_required > 0 THEN e.component_id ELSE NULL END AS demand_component_id
  FROM cases c
  JOIN extracted e ON e.case_name = c.case_name
)
SELECT
  case_name,
  component_ok,
  quantity_ok,
  demand_component_id
FROM assertions
ORDER BY case_name;
