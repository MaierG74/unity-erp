-- Closure engine — RPC API surface (POL-109)
-- Sub-issue (c) of 5 for POL-100. Implements the 9 SQL functions that wrap
-- closure-engine state transitions, plus an internal activity-logging helper.
-- Depends on POL-107 (closure_items, closure_item_activity) and POL-108
-- (closure_item_sla_pauses, closure_escalation_events).
-- See docs/projects/purchasing-agent-implementation-plan.md §3.4 (API surface),
-- §2.5 (read/write patterns), §3.5 (pause semantics), §3.6 (escalation policy).
--
-- DESIGN NOTES
--
-- 1. Each RPC takes `p_org_id` as an explicit parameter. The Edge Function
--    layer (landing after POL-112) is responsible for deriving `p_org_id`
--    from `agent_credentials` before calling. The RPCs trust `p_org_id`.
--
-- 2. All RPCs are SECURITY DEFINER with explicit search_path. EXECUTE is
--    REVOKED from public/anon/authenticated and GRANTed to service_role
--    only. UI access (when added later) goes through thin authenticated
--    wrappers that derive p_org_id from auth.uid() + is_org_member.
--
-- 3. Edge Function wrappers (with agent_credentials auth + idempotency via
--    agent_action_log.idempotency_key) land in a separate ticket once
--    POL-112 has shipped agent_action_log.
--
-- 4. register_closure_item is idempotent by source_fingerprint (via the
--    partial unique index on closure_items from POL-107). Other RPCs rely
--    on the Edge Function layer for idempotency.

-- =========================================================================
-- Internal helper: append a row to closure_item_activity.
-- Underscore prefix marks this as internal — RPCs call it; nothing else
-- should.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_log_activity(
  p_org_id              UUID,
  p_closure_item_id     UUID,
  p_event_type          TEXT,
  p_performed_by_user_id  UUID,
  p_performed_by_agent_id TEXT,
  p_notes               TEXT,
  p_payload             JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.closure_item_activity (
    org_id, closure_item_id, event_type,
    performed_by_user_id, performed_by_agent_id,
    notes, payload
  ) VALUES (
    p_org_id, p_closure_item_id, p_event_type,
    p_performed_by_user_id, p_performed_by_agent_id,
    p_notes, COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public._closure_log_activity IS
  'Internal: append a row to closure_item_activity. Called by closure-engine RPCs only.';

-- =========================================================================
-- 1. register_closure_item
-- Idempotent create-or-update by source_fingerprint. If a non-terminal item
-- already exists for (org, source_type, source_fingerprint), update its
-- last_observed_at and merge the payload. Otherwise insert a new row.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.register_closure_item(
  p_org_id                UUID,
  p_source_type           TEXT,
  p_source_id             TEXT,
  p_source_fingerprint    TEXT,
  p_capability            TEXT,
  p_item_type             TEXT,
  p_title                 TEXT,
  p_summary               TEXT             DEFAULT NULL,
  p_severity              TEXT             DEFAULT 'medium',
  p_owner_user_id         UUID             DEFAULT NULL,
  p_owner_agent_id        TEXT             DEFAULT NULL,
  p_owner_role            TEXT             DEFAULT NULL,
  p_opened_by_user_id     UUID             DEFAULT NULL,
  p_opened_by_agent_id    TEXT             DEFAULT NULL,
  p_sla_minutes           INTEGER          DEFAULT 480,
  p_due_at                TIMESTAMPTZ      DEFAULT NULL,
  p_payload               JSONB            DEFAULT '{}'::jsonb,
  p_escalation_policy     JSONB            DEFAULT '{}'::jsonb,
  p_next_escalation_at    TIMESTAMPTZ      DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;
  IF COALESCE(p_source_fingerprint, '') = '' THEN
    RAISE EXCEPTION 'p_source_fingerprint is required';
  END IF;

  -- Look for an existing non-terminal item (matches the partial unique idx)
  SELECT id INTO v_existing_id
  FROM public.closure_items
  WHERE org_id = p_org_id
    AND source_type = p_source_type
    AND source_fingerprint = p_source_fingerprint
    AND status NOT IN ('closed', 'cancelled')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Idempotent observe: merge payload, bump last_observed_at, refresh
    -- mutable display fields. DO NOT change status, owner, or escalation
    -- state — those have dedicated RPCs.
    UPDATE public.closure_items
    SET
      last_observed_at = NOW(),
      title            = COALESCE(p_title, title),
      summary          = COALESCE(p_summary, summary),
      payload          = payload || COALESCE(p_payload, '{}'::jsonb)
    WHERE id = v_existing_id;

    PERFORM public._closure_log_activity(
      p_org_id, v_existing_id, 'observation_updated',
      p_opened_by_user_id, p_opened_by_agent_id,
      NULL,
      jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id)
    );

    RETURN v_existing_id;
  END IF;

  -- New item
  INSERT INTO public.closure_items (
    org_id, source_type, source_id, source_fingerprint,
    capability, item_type, title, summary,
    severity,
    owner_user_id, owner_agent_id, owner_role,
    opened_by_user_id, opened_by_agent_id,
    sla_minutes, due_at,
    escalation_policy, next_escalation_at,
    payload
  ) VALUES (
    p_org_id, p_source_type, p_source_id, p_source_fingerprint,
    p_capability, p_item_type, p_title, p_summary,
    COALESCE(p_severity, 'medium'),
    p_owner_user_id, p_owner_agent_id, p_owner_role,
    p_opened_by_user_id, p_opened_by_agent_id,
    COALESCE(p_sla_minutes, 480),
    COALESCE(p_due_at, NOW() + (COALESCE(p_sla_minutes, 480) || ' minutes')::interval),
    COALESCE(p_escalation_policy, '{}'::jsonb),
    p_next_escalation_at,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_new_id;

  PERFORM public._closure_log_activity(
    p_org_id, v_new_id, 'created',
    p_opened_by_user_id, p_opened_by_agent_id,
    NULL,
    jsonb_build_object(
      'source_type', p_source_type,
      'source_id', p_source_id,
      'capability', p_capability,
      'item_type', p_item_type
    )
  );

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.register_closure_item IS
  'Idempotent create-or-update of a closure_items row by source_fingerprint. Returns the closure_item_id. Plan §3.4.';

-- =========================================================================
-- 2. record_closure_observation
-- Update last_observed_at and optionally merge a payload patch. No state /
-- ownership / escalation changes.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.record_closure_observation(
  p_org_id              UUID,
  p_closure_item_id     UUID,
  p_payload_patch       JSONB DEFAULT NULL,
  p_observed_by_user_id UUID  DEFAULT NULL,
  p_observed_by_agent_id TEXT DEFAULT NULL,
  p_notes               TEXT  DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found INTEGER;
BEGIN
  UPDATE public.closure_items
  SET
    last_observed_at = NOW(),
    payload          = payload || COALESCE(p_payload_patch, '{}'::jsonb)
  WHERE id = p_closure_item_id
    AND org_id = p_org_id;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found = 0 THEN
    RAISE EXCEPTION 'closure_item % not found in org %', p_closure_item_id, p_org_id;
  END IF;

  PERFORM public._closure_log_activity(
    p_org_id, p_closure_item_id, 'observation_updated',
    p_observed_by_user_id, p_observed_by_agent_id,
    p_notes, COALESCE(p_payload_patch, '{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.record_closure_observation IS
  'Bump last_observed_at and merge an optional payload patch. Plan §3.4.';

-- =========================================================================
-- 3. assign_closure_item
-- Change owner. At least one of owner_user_id / owner_agent_id / owner_role
-- should be provided; the RPC accepts NULLs for fields the caller wants to
-- clear.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.assign_closure_item(
  p_org_id                UUID,
  p_closure_item_id       UUID,
  p_owner_user_id         UUID DEFAULT NULL,
  p_owner_agent_id        TEXT DEFAULT NULL,
  p_owner_role            TEXT DEFAULT NULL,
  p_assigned_by_user_id   UUID DEFAULT NULL,
  p_assigned_by_agent_id  TEXT DEFAULT NULL,
  p_notes                 TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_user_id  UUID;
  v_prev_agent_id TEXT;
  v_prev_role     TEXT;
  v_found         INTEGER;
BEGIN
  SELECT owner_user_id, owner_agent_id, owner_role
    INTO v_prev_user_id, v_prev_agent_id, v_prev_role
  FROM public.closure_items
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closure_item % not found in org %', p_closure_item_id, p_org_id;
  END IF;

  UPDATE public.closure_items
  SET
    owner_user_id  = p_owner_user_id,
    owner_agent_id = p_owner_agent_id,
    owner_role     = p_owner_role
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found = 0 THEN
    RAISE EXCEPTION 'assign update missed for closure_item % in org %', p_closure_item_id, p_org_id;
  END IF;

  PERFORM public._closure_log_activity(
    p_org_id, p_closure_item_id, 'owner_assigned',
    p_assigned_by_user_id, p_assigned_by_agent_id,
    p_notes,
    jsonb_build_object(
      'from', jsonb_build_object('user_id', v_prev_user_id, 'agent_id', v_prev_agent_id, 'role', v_prev_role),
      'to',   jsonb_build_object('user_id', p_owner_user_id, 'agent_id', p_owner_agent_id, 'role', p_owner_role)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.assign_closure_item IS
  'Change owner of a closure_item. Plan §3.4.';

-- =========================================================================
-- 4. set_closure_status
-- Move between non-terminal statuses (open/in_progress/waiting_external/
-- blocked). 'closed' and 'cancelled' have their own RPC (close_closure_item).
-- 'paused' has its own RPC (pause_closure_sla).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.set_closure_status(
  p_org_id              UUID,
  p_closure_item_id     UUID,
  p_new_status          TEXT,
  p_changed_by_user_id  UUID DEFAULT NULL,
  p_changed_by_agent_id TEXT DEFAULT NULL,
  p_notes               TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status TEXT;
  v_found       INTEGER;
BEGIN
  IF p_new_status NOT IN ('open', 'in_progress', 'waiting_external', 'blocked') THEN
    RAISE EXCEPTION
      'set_closure_status only handles non-terminal/non-paused transitions; got %. Use close_closure_item / pause_closure_sla / resume_closure_sla for the others.',
      p_new_status;
  END IF;

  SELECT status INTO v_prev_status
  FROM public.closure_items
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closure_item % not found in org %', p_closure_item_id, p_org_id;
  END IF;

  IF v_prev_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'closure_item % is already terminal (%) — cannot change status', p_closure_item_id, v_prev_status;
  END IF;

  IF v_prev_status = 'paused' THEN
    RAISE EXCEPTION 'closure_item % is paused — call resume_closure_sla first', p_closure_item_id;
  END IF;

  IF v_prev_status = p_new_status THEN
    -- No-op, do not log noise
    RETURN;
  END IF;

  UPDATE public.closure_items
  SET status = p_new_status
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found = 0 THEN
    RAISE EXCEPTION 'set_closure_status update missed for closure_item % in org %', p_closure_item_id, p_org_id;
  END IF;

  PERFORM public._closure_log_activity(
    p_org_id, p_closure_item_id, 'status_changed',
    p_changed_by_user_id, p_changed_by_agent_id,
    p_notes,
    jsonb_build_object('from', v_prev_status, 'to', p_new_status)
  );
END;
$$;

COMMENT ON FUNCTION public.set_closure_status IS
  'Move a closure_item between non-terminal, non-paused statuses. Plan §3.4.';

-- =========================================================================
-- 5. pause_closure_sla
-- Open a new pause window: insert into closure_item_sla_pauses, set
-- closure_items.paused_at + status='paused'. Refuses if already paused.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.pause_closure_sla(
  p_org_id              UUID,
  p_closure_item_id     UUID,
  p_reason_code         TEXT,
  p_notes               TEXT DEFAULT NULL,
  p_paused_by_user_id   UUID DEFAULT NULL,
  p_paused_by_agent_id  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status      TEXT;
  v_already     TIMESTAMPTZ;
  v_pause_id    UUID;
BEGIN
  IF COALESCE(p_reason_code, '') = '' THEN
    RAISE EXCEPTION 'p_reason_code is required to pause an SLA clock';
  END IF;

  SELECT status, paused_at INTO v_status, v_already
  FROM public.closure_items
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closure_item % not found in org %', p_closure_item_id, p_org_id;
  END IF;

  IF v_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'closure_item % is terminal (%) — cannot pause', p_closure_item_id, v_status;
  END IF;

  IF v_already IS NOT NULL THEN
    RAISE EXCEPTION 'closure_item % is already paused since %', p_closure_item_id, v_already;
  END IF;

  INSERT INTO public.closure_item_sla_pauses (
    org_id, closure_item_id, reason_code, notes,
    paused_by_user_id, paused_by_agent_id
  ) VALUES (
    p_org_id, p_closure_item_id, p_reason_code, p_notes,
    p_paused_by_user_id, p_paused_by_agent_id
  )
  RETURNING id INTO v_pause_id;

  UPDATE public.closure_items
  SET
    status            = 'paused',
    paused_at         = NOW(),
    pause_reason_code = p_reason_code
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  PERFORM public._closure_log_activity(
    p_org_id, p_closure_item_id, 'sla_paused',
    p_paused_by_user_id, p_paused_by_agent_id,
    p_notes,
    jsonb_build_object('reason_code', p_reason_code, 'pause_id', v_pause_id)
  );

  RETURN v_pause_id;
END;
$$;

COMMENT ON FUNCTION public.pause_closure_sla IS
  'Open a new SLA pause window. Returns the pause_id. Refuses if already paused or terminal. Plan §3.5.';

-- =========================================================================
-- 6. resume_closure_sla
-- Close the open pause window, accumulate seconds onto
-- closure_items.total_paused_seconds, clear paused_at, restore status.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.resume_closure_sla(
  p_org_id              UUID,
  p_closure_item_id     UUID,
  p_resumed_by_user_id  UUID DEFAULT NULL,
  p_resumed_by_agent_id TEXT DEFAULT NULL,
  p_notes               TEXT DEFAULT NULL,
  p_new_status          TEXT DEFAULT 'in_progress'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pause_id        UUID;
  v_pause_started   TIMESTAMPTZ;
  v_now             TIMESTAMPTZ := NOW();
  v_seconds_added   INTEGER;
  v_status          TEXT;
BEGIN
  IF p_new_status NOT IN ('open', 'in_progress', 'waiting_external', 'blocked') THEN
    RAISE EXCEPTION
      'resume_closure_sla can only restore to open/in_progress/waiting_external/blocked; got %',
      p_new_status;
  END IF;

  SELECT status INTO v_status
  FROM public.closure_items
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closure_item % not found in org %', p_closure_item_id, p_org_id;
  END IF;

  IF v_status <> 'paused' THEN
    RAISE EXCEPTION 'closure_item % is not paused (current status: %)', p_closure_item_id, v_status;
  END IF;

  -- Find the open pause row
  SELECT id, pause_started_at
    INTO v_pause_id, v_pause_started
  FROM public.closure_item_sla_pauses
  WHERE closure_item_id = p_closure_item_id
    AND org_id = p_org_id
    AND pause_ended_at IS NULL
  ORDER BY pause_started_at DESC
  LIMIT 1;

  IF v_pause_id IS NULL THEN
    RAISE EXCEPTION 'closure_item % is marked paused but has no open pause row — manual fix required', p_closure_item_id;
  END IF;

  v_seconds_added := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_pause_started))::INTEGER);

  UPDATE public.closure_item_sla_pauses
  SET
    pause_ended_at      = v_now,
    resumed_by_user_id  = p_resumed_by_user_id,
    resumed_by_agent_id = p_resumed_by_agent_id,
    notes               = COALESCE(p_notes, notes)
  WHERE id = v_pause_id;

  UPDATE public.closure_items
  SET
    status                = p_new_status,
    paused_at             = NULL,
    pause_reason_code     = NULL,
    total_paused_seconds  = total_paused_seconds + v_seconds_added
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  PERFORM public._closure_log_activity(
    p_org_id, p_closure_item_id, 'sla_resumed',
    p_resumed_by_user_id, p_resumed_by_agent_id,
    p_notes,
    jsonb_build_object(
      'pause_id', v_pause_id,
      'seconds_added', v_seconds_added,
      'restored_status', p_new_status
    )
  );

  RETURN v_seconds_added;
END;
$$;

COMMENT ON FUNCTION public.resume_closure_sla IS
  'Close the open pause window and accumulate elapsed seconds onto closure_items.total_paused_seconds. Returns seconds added. Plan §3.5.';

-- =========================================================================
-- 7. close_closure_item
-- Terminal transition. Requires a non-empty closure_note. Allows status =
-- 'closed' (default) or 'cancelled'. Auto-resumes any open pause first so
-- total_paused_seconds is consistent.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.close_closure_item(
  p_org_id            UUID,
  p_closure_item_id   UUID,
  p_closure_note      TEXT,
  p_status            TEXT DEFAULT 'closed',
  p_closed_by_user_id UUID DEFAULT NULL,
  p_closed_by_agent_id TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status TEXT;
  v_found       INTEGER;
BEGIN
  IF p_status NOT IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'close_closure_item only allows status=closed or cancelled; got %', p_status;
  END IF;

  IF COALESCE(BTRIM(p_closure_note), '') = '' THEN
    RAISE EXCEPTION 'p_closure_note is required and must be non-empty';
  END IF;

  SELECT status INTO v_prev_status
  FROM public.closure_items
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'closure_item % not found in org %', p_closure_item_id, p_org_id;
  END IF;

  IF v_prev_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'closure_item % is already terminal (%)', p_closure_item_id, v_prev_status;
  END IF;

  -- If currently paused, auto-resume so total_paused_seconds is consistent
  IF v_prev_status = 'paused' THEN
    PERFORM public.resume_closure_sla(
      p_org_id, p_closure_item_id,
      p_closed_by_user_id, p_closed_by_agent_id,
      'Auto-resumed on close',
      'open'  -- intermediate; we override below
    );
  END IF;

  UPDATE public.closure_items
  SET
    status              = p_status,
    closure_note        = p_closure_note,
    closed_at           = NOW(),
    closed_by_user_id   = p_closed_by_user_id,
    closed_by_agent_id  = p_closed_by_agent_id
  WHERE id = p_closure_item_id AND org_id = p_org_id;

  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found = 0 THEN
    RAISE EXCEPTION 'close update missed for closure_item % in org %', p_closure_item_id, p_org_id;
  END IF;

  PERFORM public._closure_log_activity(
    p_org_id, p_closure_item_id, p_status,  -- 'closed' or 'cancelled'
    p_closed_by_user_id, p_closed_by_agent_id,
    p_closure_note,
    jsonb_build_object('from_status', v_prev_status)
  );
END;
$$;

COMMENT ON FUNCTION public.close_closure_item IS
  'Terminal transition (status=closed or cancelled). Requires non-empty closure_note. Auto-resumes any open pause first. Plan §3.4.';

-- =========================================================================
-- 8. escalate_due_closure_items
-- Walk through all rows where now() >= next_escalation_at and the item is
-- not terminal/paused. For each, advance escalation_level, write a
-- closure_escalation_events row, recompute next_escalation_at from
-- escalation_policy.steps[new_level].after_minutes (relative to opened_at).
-- Returns count of items escalated.
--
-- Designed to be called by a cron at the agent runtime layer.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.escalate_due_closure_items(
  p_org_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             RECORD;
  v_count           INTEGER := 0;
  v_new_level       INTEGER;
  v_step            JSONB;
  v_next_step       JSONB;
  v_target_type     TEXT;
  v_target_user_id  UUID;
  v_target_role     TEXT;
  v_next_after_min  INTEGER;
  v_next_at         TIMESTAMPTZ;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'p_org_id is required';
  END IF;

  FOR v_row IN
    SELECT id, opened_at, escalation_level, escalation_policy, owner_user_id, owner_role
    FROM public.closure_items
    WHERE org_id = p_org_id
      AND status NOT IN ('closed', 'cancelled', 'paused')
      AND next_escalation_at IS NOT NULL
      AND next_escalation_at <= NOW()
    ORDER BY next_escalation_at ASC
    FOR UPDATE
  LOOP
    v_new_level := v_row.escalation_level + 1;

    -- Look up the step we're firing (zero-indexed; escalation_level is the
    -- count of steps already fired, so steps[escalation_level] is "next").
    v_step := COALESCE(v_row.escalation_policy -> 'steps' -> v_row.escalation_level, '{}'::jsonb);
    v_target_type := COALESCE(v_step ->> 'target', 'daily_brief');

    -- Validate target_type is in the CHECK constraint set
    IF v_target_type NOT IN ('owner', 'supervisor', 'daily_brief', 'weekly_digest') THEN
      v_target_type := 'daily_brief';
    END IF;

    -- For 'owner' target, attach the owner_user_id/role from the item itself
    IF v_target_type = 'owner' THEN
      v_target_user_id := v_row.owner_user_id;
      v_target_role    := v_row.owner_role;
    ELSE
      v_target_user_id := NULL;
      v_target_role    := v_target_type;
    END IF;

    INSERT INTO public.closure_escalation_events (
      org_id, closure_item_id, escalation_level, target_type,
      target_user_id, target_role, message_key, payload
    ) VALUES (
      p_org_id, v_row.id, v_new_level, v_target_type,
      v_target_user_id, v_target_role,
      v_step ->> 'channel',
      jsonb_build_object('step', v_step)
    );

    -- Compute next escalation time from the FOLLOWING step
    v_next_step := v_row.escalation_policy -> 'steps' -> v_new_level;
    IF v_next_step IS NOT NULL AND (v_next_step ? 'after_minutes') THEN
      v_next_after_min := (v_next_step ->> 'after_minutes')::INTEGER;
      v_next_at := v_row.opened_at + (v_next_after_min || ' minutes')::interval;
    ELSE
      v_next_at := NULL;  -- exhausted
    END IF;

    UPDATE public.closure_items
    SET
      escalation_level   = v_new_level,
      next_escalation_at = v_next_at
    WHERE id = v_row.id;

    PERFORM public._closure_log_activity(
      p_org_id, v_row.id, 'escalated',
      NULL, 'closure-engine',
      NULL,
      jsonb_build_object(
        'level', v_new_level,
        'target_type', v_target_type,
        'next_at', v_next_at
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.escalate_due_closure_items IS
  'Cron-driven walker. Advances escalation_level for due items, writes closure_escalation_events row, recomputes next_escalation_at from escalation_policy.steps[new_level].after_minutes. Returns count of items escalated. Plan §3.4 + §3.6.';

-- =========================================================================
-- 9. get_daily_closure_brief
-- Aggregate summary for the daily Telegram brief. Returns a single jsonb
-- object so the brief generator can extract sections without round-tripping.
-- =========================================================================

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

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb)
    INTO v_oldest
  FROM (
    SELECT
      id,
      title,
      severity,
      status,
      owner_user_id,
      owner_agent_id,
      owner_role,
      capability,
      item_type,
      opened_at,
      due_at,
      escalation_level,
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

COMMENT ON FUNCTION public.get_daily_closure_brief IS
  'Aggregate summary of closure_items state for the daily Telegram brief. Returns a single jsonb object. Plan §3.4.';

-- =========================================================================
-- GRANT / REVOKE
-- All RPCs are service_role only. Edge Functions (with agent_credentials
-- auth) are the call surface for week 1; UI access comes later via
-- additional thin wrappers if needed.
-- =========================================================================

REVOKE EXECUTE ON FUNCTION public._closure_log_activity                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.register_closure_item                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_closure_observation           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_closure_item                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_closure_status                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pause_closure_sla                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resume_closure_sla                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_closure_item                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.escalate_due_closure_items           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_daily_closure_brief              FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public._closure_log_activity                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_closure_item                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_closure_observation           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_closure_item                  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_closure_status                   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pause_closure_sla                    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resume_closure_sla                   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.close_closure_item                   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.escalate_due_closure_items           FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_daily_closure_brief              FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public._closure_log_activity                 TO service_role;
GRANT EXECUTE ON FUNCTION public.register_closure_item                 TO service_role;
GRANT EXECUTE ON FUNCTION public.record_closure_observation            TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_closure_item                   TO service_role;
GRANT EXECUTE ON FUNCTION public.set_closure_status                    TO service_role;
GRANT EXECUTE ON FUNCTION public.pause_closure_sla                     TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_closure_sla                    TO service_role;
GRANT EXECUTE ON FUNCTION public.close_closure_item                    TO service_role;
GRANT EXECUTE ON FUNCTION public.escalate_due_closure_items            TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_closure_brief               TO service_role;
