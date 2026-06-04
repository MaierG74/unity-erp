-- resume_closure_sla used NOW() (= transaction-start time) for both
-- pause_ended_at and the elapsed-seconds calculation. Within a single
-- transaction, that always evaluates to zero seconds elapsed; in long-
-- running transactions in production it under-counts. Fix: use
-- clock_timestamp() (real wall-clock time) so duration is accurate
-- regardless of transaction boundaries.
--
-- Hotfix on POL-109. Discovered via the in-session functional smoke test
-- (pause + pg_sleep(2) + resume returned 0 seconds because the whole DO
-- block ran in one transaction).

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
  v_now             TIMESTAMPTZ := clock_timestamp();
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

  SELECT id, pause_started_at
    INTO v_pause_id, v_pause_started
  FROM public.closure_item_sla_pauses
  WHERE closure_item_id = p_closure_item_id
    AND org_id = p_org_id
    AND pause_ended_at IS NULL
  ORDER BY pause_started_at DESC
  LIMIT 1;

  IF v_pause_id IS NULL THEN
    RAISE EXCEPTION 'closure_item % is marked paused but has no open pause row - manual fix required', p_closure_item_id;
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
