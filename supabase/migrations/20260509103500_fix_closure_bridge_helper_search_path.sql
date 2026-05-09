-- Fix: the 4 IMMUTABLE helper functions in the closure-engine bridge
-- (_closure_bridge_severity_for_variance, _status_for_source,
-- _event_for_source, _payload) were missing SET search_path = public.
-- The advisor flags this as function_search_path_mutable. The SECURITY
-- DEFINER trigger functions had it set; the helpers got skipped because
-- they don't touch tables. Adding it anyway for consistency with the
-- project's hardening direction.
--
-- Hotfix on POL-111 in the same session as the parent migration.

CREATE OR REPLACE FUNCTION public._closure_bridge_severity_for_variance(p_variance INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_variance IS NULL THEN
    RETURN 'medium';
  END IF;
  IF abs(p_variance) >= 50 THEN
    RETURN 'high';
  ELSIF abs(p_variance) >= 10 THEN
    RETURN 'medium';
  ELSE
    RETURN 'low';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._closure_bridge_status_for_source(p_source_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_source_status
    WHEN 'open'         THEN 'open'
    WHEN 'acknowledged' THEN 'in_progress'
    WHEN 'resolved'     THEN 'closed'
    ELSE 'open'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._closure_bridge_event_for_source(p_source_event TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN CASE p_source_event
    WHEN 'created'              THEN 'created'
    WHEN 'acknowledged'         THEN 'status_changed'
    WHEN 'resolved'             THEN 'closed'
    WHEN 'auto_resolved'        THEN 'closed'
    ELSE 'observation_updated'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._closure_bridge_payload(
  p_exception_id          BIGINT,
  p_order_id              INTEGER,
  p_work_pool_id          INTEGER,
  p_required_qty_snapshot INTEGER,
  p_issued_qty_snapshot   INTEGER,
  p_variance_qty          INTEGER,
  p_trigger_source        TEXT,
  p_trigger_context       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'exception_id',           p_exception_id,
    'order_id',               p_order_id,
    'work_pool_id',           p_work_pool_id,
    'required_qty_snapshot',  p_required_qty_snapshot,
    'issued_qty_snapshot',    p_issued_qty_snapshot,
    'variance_qty',           p_variance_qty,
    'trigger_source',         p_trigger_source,
    'trigger_context',        COALESCE(p_trigger_context, '{}'::jsonb)
  );
END;
$$;
