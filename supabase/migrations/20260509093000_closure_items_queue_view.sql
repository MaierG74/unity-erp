-- Closure engine — closure_items_queue computed view (POL-110)
-- Sub-issue (d) of 5 for POL-100. Wraps closure_items with computed
-- age_minutes, minutes_until_due, sla_breached so consumers (daily brief,
-- future dashboard panel) read trustworthy aging without storing it.
-- See docs/projects/purchasing-agent-implementation-plan.md §3.3
--
-- Created WITH (security_invoker = true) so RLS on the underlying
-- closure_items table propagates to view callers — an authenticated user
-- only sees their own org's rows; service_role (Edge Functions) bypasses
-- RLS and sees everything. This also avoids the security_definer_view
-- advisor warning class.

CREATE OR REPLACE VIEW public.closure_items_queue
  WITH (security_invoker = true)
AS
SELECT
  ci.*,
  -- Age in minutes, accounting for paused windows. For closed items, age
  -- is frozen at closed_at - opened_at - paused. For active items, age
  -- ticks forward with NOW() but excludes time spent in pauses.
  FLOOR(
    EXTRACT(EPOCH FROM (
      COALESCE(ci.closed_at, NOW())
      - ci.opened_at
      - (ci.total_paused_seconds * INTERVAL '1 second')
    )) / 60
  )::INTEGER AS age_minutes,
  -- Minutes until due (negative if past due). NULL when no due_at set.
  CASE
    WHEN ci.due_at IS NULL THEN NULL
    ELSE FLOOR(EXTRACT(EPOCH FROM (ci.due_at - NOW())) / 60)::INTEGER
  END AS minutes_until_due,
  -- True only for items that have a due_at AND are past it.
  CASE
    WHEN ci.due_at IS NOT NULL AND NOW() > ci.due_at THEN TRUE
    ELSE FALSE
  END AS sla_breached
FROM public.closure_items ci;

COMMENT ON VIEW public.closure_items_queue IS
  'Closure_items with computed age_minutes / minutes_until_due / sla_breached. security_invoker=true so org-scoped RLS on closure_items propagates to the caller. See docs/projects/purchasing-agent-implementation-plan.md §3.3.';
