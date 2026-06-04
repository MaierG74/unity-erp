-- Closure engine — bridge from job_work_pool_exceptions to closure_items (POL-111)
-- Sub-issue (e) of 5 for POL-100. The LAST POL-100 sub-issue. Backfills active
-- manufacturing exceptions into the new closure-engine primitive WITHOUT cutting
-- over the existing UI. Manufacturing UI continues reading the existing
-- exception tables; closure-engine consumers (Sam, future dashboard) read
-- closure_items.
--
-- See docs/projects/purchasing-agent-implementation-plan.md §3.7
--
-- DESIGN NOTES
--
-- 1. ONE-WAY mirror: source (job_work_pool_exceptions) -> mirror (closure_items).
--    New closure_items writes do NOT propagate back. Sam writes against
--    closure_items directly for capabilities that aren't manufacturing
--    exceptions; the bridge only handles the pre-existing exception flow.
--
-- 2. Three triggers:
--    a. AFTER INSERT on job_work_pool_exceptions       -> create mirror + 'created' activity
--    b. AFTER UPDATE on job_work_pool_exceptions       -> sync status / payload / closed_at
--    c. AFTER INSERT on job_work_pool_exception_activity -> append mapped event to closure_item_activity
--
-- 3. RESILIENCE POLICY: bridge triggers RAISE WARNING on mirror failure and
--    let the source operation commit. This prevents a bridge bug from breaking
--    the live manufacturing UI. Trade-off is silent drift — which we can
--    detect via a reconciliation cron later. For v1 this is the right
--    trade-off; manufacturing keeps working, closure-engine consumers see
--    eventual consistency at worst.
--
-- 4. Idempotency: the backfill uses NOT EXISTS (matching the partial unique
--    on closure_items) so it can be re-run safely. Triggers are also
--    idempotent — INSERT trigger checks for existing mirror, UPDATE trigger
--    no-ops when nothing's changed.

-- =========================================================================
-- _closure_bridge_severity_for_variance: derive severity from variance_qty.
-- Helper used by both backfill and the INSERT trigger.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_bridge_severity_for_variance(p_variance INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
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

-- =========================================================================
-- _closure_bridge_status_for_source: map source status -> mirror status.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_bridge_status_for_source(p_source_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
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

-- =========================================================================
-- _closure_bridge_event_for_source: map source activity event_type -> mirror.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_bridge_event_for_source(p_source_event TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_source_event
    WHEN 'created'              THEN 'created'
    WHEN 'acknowledged'         THEN 'status_changed'
    WHEN 'resolved'             THEN 'closed'
    WHEN 'auto_resolved'        THEN 'closed'
    -- Everything else maps to a non-state-changing observation.
    ELSE 'observation_updated'
  END;
END;
$$;

-- =========================================================================
-- _closure_bridge_payload: build the closure_items.payload for an exception.
-- =========================================================================

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

-- =========================================================================
-- BACKFILL — one-time copy of currently-open exceptions into closure_items.
-- Idempotent via NOT EXISTS on the partial unique constraint.
-- =========================================================================

DO $backfill$
DECLARE
  v_inserted INTEGER;
BEGIN
  WITH inserted AS (
    INSERT INTO public.closure_items (
      org_id, source_type, source_id, source_fingerprint,
      capability, item_type,
      title, summary, severity, status,
      opened_at, last_observed_at, first_seen_at,
      payload
    )
    SELECT
      e.org_id,
      'job_work_pool_exception',
      e.exception_id::text,
      'job_work_pool_exception:' || e.exception_id,
      'manufacturing_exception',
      e.exception_type,
      format('Work-pool exception %s on order %s', e.exception_type, e.order_id),
      CASE
        WHEN e.variance_qty IS NULL THEN NULL
        ELSE format('Variance %s (required %s, issued %s)',
                    e.variance_qty, e.required_qty_snapshot, e.issued_qty_snapshot)
      END,
      public._closure_bridge_severity_for_variance(e.variance_qty),
      public._closure_bridge_status_for_source(e.status),
      e.triggered_at,
      COALESCE(e.updated_at, e.triggered_at),
      e.triggered_at,
      public._closure_bridge_payload(
        e.exception_id, e.order_id, e.work_pool_id,
        e.required_qty_snapshot, e.issued_qty_snapshot, e.variance_qty,
        e.trigger_source, e.trigger_context
      )
    FROM public.job_work_pool_exceptions e
    WHERE e.status IN ('open', 'acknowledged')
      AND NOT EXISTS (
        SELECT 1 FROM public.closure_items ci
        WHERE ci.org_id = e.org_id
          AND ci.source_type = 'job_work_pool_exception'
          AND ci.source_fingerprint = 'job_work_pool_exception:' || e.exception_id
          AND ci.status NOT IN ('closed', 'cancelled')
      )
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM inserted;

  RAISE NOTICE 'Closure-engine bridge backfill: % active exceptions mirrored', v_inserted;
END;
$backfill$;

-- =========================================================================
-- TRIGGER 1 — AFTER INSERT on job_work_pool_exceptions
-- Mirror new exceptions into closure_items + log 'created' activity.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_bridge_on_exception_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID;
BEGIN
  -- Idempotency: if a mirror already exists (from backfill or replay), skip.
  SELECT id INTO v_existing_id
  FROM public.closure_items
  WHERE org_id = NEW.org_id
    AND source_type = 'job_work_pool_exception'
    AND source_fingerprint = 'job_work_pool_exception:' || NEW.exception_id
    AND status NOT IN ('closed', 'cancelled');

  IF v_existing_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.closure_items (
      org_id, source_type, source_id, source_fingerprint,
      capability, item_type,
      title, summary, severity, status,
      opened_by_user_id, opened_at, last_observed_at, first_seen_at,
      payload
    ) VALUES (
      NEW.org_id,
      'job_work_pool_exception',
      NEW.exception_id::text,
      'job_work_pool_exception:' || NEW.exception_id,
      'manufacturing_exception',
      NEW.exception_type,
      format('Work-pool exception %s on order %s', NEW.exception_type, NEW.order_id),
      CASE
        WHEN NEW.variance_qty IS NULL THEN NULL
        ELSE format('Variance %s (required %s, issued %s)',
                    NEW.variance_qty, NEW.required_qty_snapshot, NEW.issued_qty_snapshot)
      END,
      public._closure_bridge_severity_for_variance(NEW.variance_qty),
      public._closure_bridge_status_for_source(NEW.status),
      NEW.triggered_by,
      NEW.triggered_at,
      COALESCE(NEW.updated_at, NEW.triggered_at),
      NEW.triggered_at,
      public._closure_bridge_payload(
        NEW.exception_id, NEW.order_id, NEW.work_pool_id,
        NEW.required_qty_snapshot, NEW.issued_qty_snapshot, NEW.variance_qty,
        NEW.trigger_source, NEW.trigger_context
      )
    ) RETURNING id INTO v_new_id;

    -- Log the corresponding 'created' activity row on the mirror side.
    -- (The source-side activity row is logged separately by the existing
    -- log_job_work_pool_exception_activity helper, which fires our
    -- activity-mirror trigger.)
    INSERT INTO public.closure_item_activity (
      org_id, closure_item_id, event_type,
      performed_by_user_id, performed_by_agent_id,
      notes, payload
    ) VALUES (
      NEW.org_id, v_new_id, 'created',
      NEW.triggered_by, 'closure-engine-bridge',
      NULL,
      jsonb_build_object(
        'exception_id', NEW.exception_id,
        'exception_type', NEW.exception_type,
        'trigger_source', NEW.trigger_source
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log loudly but DO NOT cancel the source insert — manufacturing UI
    -- must keep working even if the bridge is broken. Reconciliation cron
    -- (separate ticket) detects orphans.
    RAISE WARNING '[closure-bridge] failed to mirror exception_id=% (org=%): % %',
      NEW.exception_id, NEW.org_id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER closure_bridge_exception_insert
  AFTER INSERT ON public.job_work_pool_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public._closure_bridge_on_exception_insert();

-- =========================================================================
-- TRIGGER 2 — AFTER UPDATE on job_work_pool_exceptions
-- Sync status / variance snapshot / closure_note when the source row changes.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_bridge_on_exception_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mirror_id     UUID;
  v_mirror_status TEXT;
  v_new_status    TEXT;
  v_now           TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- No-op if nothing material changed
  IF NEW.status                  IS NOT DISTINCT FROM OLD.status
     AND NEW.variance_qty        IS NOT DISTINCT FROM OLD.variance_qty
     AND NEW.required_qty_snapshot IS NOT DISTINCT FROM OLD.required_qty_snapshot
     AND NEW.issued_qty_snapshot IS NOT DISTINCT FROM OLD.issued_qty_snapshot
     AND NEW.resolution_type     IS NOT DISTINCT FROM OLD.resolution_type
     AND NEW.resolution_notes    IS NOT DISTINCT FROM OLD.resolution_notes
  THEN
    RETURN NEW;
  END IF;

  SELECT id, status INTO v_mirror_id, v_mirror_status
  FROM public.closure_items
  WHERE org_id = NEW.org_id
    AND source_type = 'job_work_pool_exception'
    AND source_fingerprint = 'job_work_pool_exception:' || NEW.exception_id
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_mirror_id IS NULL THEN
    RAISE WARNING '[closure-bridge] UPDATE on exception_id=% but no mirror exists; skipping',
      NEW.exception_id;
    RETURN NEW;
  END IF;

  v_new_status := public._closure_bridge_status_for_source(NEW.status);

  BEGIN
    -- Status moved to 'closed'? Set closure_note + closed_at + closed_by.
    IF NEW.status = 'resolved' AND v_mirror_status NOT IN ('closed', 'cancelled') THEN
      UPDATE public.closure_items
      SET
        status              = 'closed',
        closure_note        = COALESCE(NEW.resolution_notes,
                                       format('Resolved as %s', COALESCE(NEW.resolution_type, 'unspecified'))),
        closed_at           = COALESCE(NEW.resolved_at, v_now),
        closed_by_user_id   = NEW.resolved_by,
        closed_by_agent_id  = 'closure-engine-bridge',
        last_observed_at    = v_now,
        payload             = payload || public._closure_bridge_payload(
          NEW.exception_id, NEW.order_id, NEW.work_pool_id,
          NEW.required_qty_snapshot, NEW.issued_qty_snapshot, NEW.variance_qty,
          NEW.trigger_source, NEW.trigger_context
        ) || jsonb_build_object('resolution_type', NEW.resolution_type)
      WHERE id = v_mirror_id;
    ELSE
      -- Non-terminal update: refresh status, payload, last_observed_at.
      -- Don't disturb closed/cancelled mirrors (defensive).
      IF v_mirror_status NOT IN ('closed', 'cancelled') THEN
        UPDATE public.closure_items
        SET
          status            = v_new_status,
          severity          = public._closure_bridge_severity_for_variance(NEW.variance_qty),
          last_observed_at  = v_now,
          payload           = payload || public._closure_bridge_payload(
            NEW.exception_id, NEW.order_id, NEW.work_pool_id,
            NEW.required_qty_snapshot, NEW.issued_qty_snapshot, NEW.variance_qty,
            NEW.trigger_source, NEW.trigger_context
          )
        WHERE id = v_mirror_id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[closure-bridge] failed to sync exception_id=% (mirror=%): % %',
      NEW.exception_id, v_mirror_id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER closure_bridge_exception_update
  AFTER UPDATE ON public.job_work_pool_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public._closure_bridge_on_exception_update();

-- =========================================================================
-- TRIGGER 3 — AFTER INSERT on job_work_pool_exception_activity
-- Mirror activity rows into closure_item_activity with mapped event_type.
-- =========================================================================

CREATE OR REPLACE FUNCTION public._closure_bridge_on_activity_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exception_id   BIGINT;
  v_mirror_id      UUID;
  v_mapped_event   TEXT;
BEGIN
  v_exception_id := NEW.exception_id;

  SELECT id INTO v_mirror_id
  FROM public.closure_items
  WHERE org_id = NEW.org_id
    AND source_type = 'job_work_pool_exception'
    AND source_fingerprint = 'job_work_pool_exception:' || v_exception_id
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_mirror_id IS NULL THEN
    -- Mirror doesn't exist yet (e.g. activity row inserted in same txn as
    -- the parent exception INSERT, but our parent INSERT trigger ran AFTER
    -- this activity trigger). Defensively skip — the parent INSERT trigger
    -- writes its own 'created' activity row, so we won't lose the trail.
    RETURN NEW;
  END IF;

  v_mapped_event := public._closure_bridge_event_for_source(NEW.event_type);

  BEGIN
    INSERT INTO public.closure_item_activity (
      org_id, closure_item_id, event_type,
      performed_by_user_id, performed_by_agent_id,
      notes, payload
    ) VALUES (
      NEW.org_id, v_mirror_id, v_mapped_event,
      NEW.performed_by, 'closure-engine-bridge',
      NEW.notes,
      COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object(
        'source_event_type', NEW.event_type,
        'source_activity_id', NEW.activity_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[closure-bridge] failed to mirror activity (exception_id=%, source_event=%): % %',
      v_exception_id, NEW.event_type, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE TRIGGER closure_bridge_activity_insert
  AFTER INSERT ON public.job_work_pool_exception_activity
  FOR EACH ROW
  EXECUTE FUNCTION public._closure_bridge_on_activity_insert();

-- =========================================================================
-- GRANTs — bridge helpers + trigger functions are internal (service_role only)
-- =========================================================================

REVOKE EXECUTE ON FUNCTION public._closure_bridge_severity_for_variance(INTEGER)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._closure_bridge_status_for_source(TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._closure_bridge_event_for_source(TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._closure_bridge_payload(BIGINT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._closure_bridge_on_exception_insert()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._closure_bridge_on_exception_update()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._closure_bridge_on_activity_insert()                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._closure_bridge_severity_for_variance(INTEGER)         TO service_role;
GRANT EXECUTE ON FUNCTION public._closure_bridge_status_for_source(TEXT)                TO service_role;
GRANT EXECUTE ON FUNCTION public._closure_bridge_event_for_source(TEXT)                 TO service_role;
GRANT EXECUTE ON FUNCTION public._closure_bridge_payload(BIGINT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public._closure_bridge_on_exception_insert()                  TO service_role;
GRANT EXECUTE ON FUNCTION public._closure_bridge_on_exception_update()                  TO service_role;
GRANT EXECUTE ON FUNCTION public._closure_bridge_on_activity_insert()                   TO service_role;

COMMENT ON TRIGGER closure_bridge_exception_insert ON public.job_work_pool_exceptions IS
  'Closure-engine bridge: mirror new exceptions into closure_items. Failures RAISE WARNING and do not cancel source insert. POL-111.';

COMMENT ON TRIGGER closure_bridge_exception_update ON public.job_work_pool_exceptions IS
  'Closure-engine bridge: sync status / variance / closure_note on exception updates. Failures RAISE WARNING and do not cancel source update. POL-111.';

COMMENT ON TRIGGER closure_bridge_activity_insert ON public.job_work_pool_exception_activity IS
  'Closure-engine bridge: mirror activity rows into closure_item_activity with mapped event_type. Failures RAISE WARNING and do not cancel source insert. POL-111.';
