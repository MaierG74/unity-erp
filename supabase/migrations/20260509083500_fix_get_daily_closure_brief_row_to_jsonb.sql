-- Fix get_daily_closure_brief: row_to_jsonb(record) failed when called from
-- inside a SECURITY DEFINER function with SET search_path. Replace with
-- explicit jsonb_build_object so the row construction is type-safe and
-- search_path-independent.
--
-- Hotfix on POL-109. Discovered immediately after the parent migration
-- via the in-session functional smoke test. Fix-forward per the migration
-- discipline rule (never edit an applied migration in place).

CREATE OR REPLACE FUNCTION public.get_daily_closure_brief(
  p_org_id UUID,
  p_since  TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since           TIMESTAMPTZ := COALESCE(p_since, NOW() - interval '24 hours');
  v_total_open      INTEGER;
  v_sla_breached    INTEGER;
  v_closed_since    INTEGER;
  v_escalations     INTEGER;
  v_by_severity     JSONB;
  v_by_status       JSONB;
  v_oldest          JSONB;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  SELECT count(*) INTO v_total_open
  FROM public.closure_items
  WHERE org_id = p_org_id
    AND status NOT IN ('closed', 'cancelled');

  SELECT count(*) INTO v_sla_breached
  FROM public.closure_items
  WHERE org_id = p_org_id
    AND status NOT IN ('closed', 'cancelled')
    AND due_at IS NOT NULL
    AND due_at < NOW();

  SELECT count(*) INTO v_closed_since
  FROM public.closure_items
  WHERE org_id = p_org_id
    AND closed_at IS NOT NULL
    AND closed_at >= v_since;

  SELECT count(*) INTO v_escalations
  FROM public.closure_escalation_events
  WHERE org_id = p_org_id
    AND fired_at >= v_since;

  SELECT COALESCE(jsonb_object_agg(severity, n), '{}'::jsonb)
    INTO v_by_severity
  FROM (
    SELECT severity, count(*) AS n
    FROM public.closure_items
    WHERE org_id = p_org_id
      AND status NOT IN ('closed', 'cancelled')
    GROUP BY severity
  ) s;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
    INTO v_by_status
  FROM (
    SELECT status, count(*) AS n
    FROM public.closure_items
    WHERE org_id = p_org_id
      AND status NOT IN ('closed', 'cancelled')
    GROUP BY status
  ) s;

  -- Oldest 5 — explicit jsonb_build_object avoids the row_to_jsonb(record)
  -- catalog-lookup failure inside SECURITY DEFINER + SET search_path.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',                t.id,
      'title',             t.title,
      'severity',          t.severity,
      'status',            t.status,
      'owner_user_id',     t.owner_user_id,
      'owner_agent_id',    t.owner_agent_id,
      'owner_role',        t.owner_role,
      'capability',        t.capability,
      'item_type',         t.item_type,
      'opened_at',         t.opened_at,
      'due_at',            t.due_at,
      'escalation_level',  t.escalation_level,
      'age_minutes',       t.age_minutes
    )
  ), '[]'::jsonb)
    INTO v_oldest
  FROM (
    SELECT
      id, title, severity, status,
      owner_user_id, owner_agent_id, owner_role,
      capability, item_type,
      opened_at, due_at, escalation_level,
      EXTRACT(EPOCH FROM (NOW() - opened_at - (total_paused_seconds * interval '1 second')))::INTEGER / 60
        AS age_minutes
    FROM public.closure_items
    WHERE org_id = p_org_id
      AND status NOT IN ('closed', 'cancelled')
    ORDER BY opened_at ASC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'org_id',           p_org_id,
    'generated_at',     NOW(),
    'since',            v_since,
    'total_open',       v_total_open,
    'sla_breached',     v_sla_breached,
    'closed_since',     v_closed_since,
    'escalations_since', v_escalations,
    'by_severity',      v_by_severity,
    'by_status',        v_by_status,
    'oldest',           v_oldest
  );
END;
$$;
