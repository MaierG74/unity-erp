-- agent_heartbeat + agent_emit_runtime_event RPCs.
-- POL-112 shipped the agent_heartbeats and agent_runtime_events tables but
-- no write RPCs. Sam's runtime can't update its own last_seen_at or log
-- host-level events without service_role direct access — which we keep off
-- ocmac-air per POL-113. These two SECURITY DEFINER RPCs close the gap.
-- Edge Function wrappers in agent-closure-rpc dispatch with skip_action_log
-- so the high-frequency heartbeat doesn't flood agent_action_log.

-- =========================================================================
-- agent_heartbeat — UPSERT one row per agent_id with real wall-clock
-- last_seen_at. Designed to be called by Sam's runtime on a 60s timer.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.agent_heartbeat(
  p_agent_id    TEXT,
  p_host_id     TEXT,
  p_status      TEXT,
  p_org_id      UUID  DEFAULT NULL,
  p_last_run_id UUID  DEFAULT NULL,
  p_payload     JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seen_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_agent_id IS NULL OR p_agent_id = '' THEN
    RAISE EXCEPTION 'p_agent_id is required';
  END IF;
  IF p_host_id IS NULL OR p_host_id = '' THEN
    RAISE EXCEPTION 'p_host_id is required';
  END IF;
  IF p_status IS NULL OR p_status = '' THEN
    RAISE EXCEPTION 'p_status is required';
  END IF;

  -- PK on agent_id → ON CONFLICT (agent_id).
  -- org_id is COALESCEd on update so a NULL-org heartbeat doesn't clear an
  -- existing org binding. Other fields are wholesale-replaced from the call.
  INSERT INTO public.agent_heartbeats AS h (
    agent_id, host_id, org_id, status, last_seen_at, last_run_id, payload
  ) VALUES (
    p_agent_id, p_host_id, p_org_id, p_status, v_seen_at, p_last_run_id,
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (agent_id) DO UPDATE
    SET host_id      = EXCLUDED.host_id,
        org_id       = COALESCE(EXCLUDED.org_id, h.org_id),
        status       = EXCLUDED.status,
        last_seen_at = v_seen_at,
        last_run_id  = EXCLUDED.last_run_id,
        payload      = EXCLUDED.payload;

  RETURN jsonb_build_object(
    'ok', true,
    'agent_id', p_agent_id,
    'last_seen_at', v_seen_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(TEXT, TEXT, TEXT, UUID, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agent_heartbeat(TEXT, TEXT, TEXT, UUID, UUID, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_heartbeat(TEXT, TEXT, TEXT, UUID, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.agent_heartbeat(TEXT, TEXT, TEXT, UUID, UUID, JSONB) IS
  'UPSERT a heartbeat row for agent_id. last_seen_at uses clock_timestamp() for real wall-clock time. org_id is COALESCEd on update — null calls do not clear an existing binding. Called via agent-closure-rpc with skip_action_log=true (heartbeats would otherwise flood agent_action_log).';

-- =========================================================================
-- agent_emit_runtime_event — host-level event log INSERT.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.agent_emit_runtime_event(
  p_agent_id   TEXT,
  p_host_id    TEXT,
  p_event_type TEXT,
  p_org_id     UUID  DEFAULT NULL,
  p_severity   TEXT  DEFAULT 'info',
  p_message    TEXT  DEFAULT NULL,
  p_payload    JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_agent_id IS NULL OR p_agent_id = '' THEN
    RAISE EXCEPTION 'p_agent_id is required';
  END IF;
  IF p_host_id IS NULL OR p_host_id = '' THEN
    RAISE EXCEPTION 'p_host_id is required';
  END IF;
  IF p_event_type IS NULL OR p_event_type = '' THEN
    RAISE EXCEPTION 'p_event_type is required';
  END IF;

  -- agent_runtime_events.severity has a CHECK over 5 values; let the table
  -- enforce that rather than re-validating here.
  INSERT INTO public.agent_runtime_events (
    agent_id, host_id, org_id, event_type, severity, message, payload
  ) VALUES (
    p_agent_id, p_host_id, p_org_id, p_event_type,
    COALESCE(p_severity, 'info'),
    p_message,
    COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agent_emit_runtime_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.agent_emit_runtime_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.agent_emit_runtime_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.agent_emit_runtime_event(TEXT, TEXT, TEXT, UUID, TEXT, TEXT, JSONB) IS
  'INSERT a row into agent_runtime_events. severity is constrained by the table CHECK (debug|info|warn|error|critical). Called via agent-closure-rpc with skip_action_log=true (events already are an event log; double-logging in agent_action_log would be redundant).';
