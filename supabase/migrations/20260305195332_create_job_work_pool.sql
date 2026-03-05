-- =============================================================================
-- Work Pool: captures labour demand (snapshot) for an order.
-- One row per order_detail + BOL line (source='bol') or manual entry (source='manual').
-- Issuance state is ALWAYS computed, never stored.
-- =============================================================================

CREATE TABLE job_work_pool (
  pool_id         SERIAL PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id),
  order_id        INTEGER NOT NULL REFERENCES orders(order_id),
  order_detail_id INTEGER REFERENCES order_details(order_detail_id),
  product_id      INTEGER REFERENCES products(product_id),
  job_id          INTEGER REFERENCES jobs(job_id),
  bol_id          INTEGER REFERENCES billoflabour(bol_id),
  source          TEXT NOT NULL DEFAULT 'bol'
                    CHECK (source IN ('bol', 'manual')),
  required_qty    INTEGER NOT NULL DEFAULT 1,
  pay_type        TEXT NOT NULL DEFAULT 'hourly',
  piece_rate      NUMERIC,
  hourly_rate_id  INTEGER,
  piece_rate_id   INTEGER,
  time_per_unit   NUMERIC,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: only BOL-sourced rows are deduplicated by order_detail + bol line
CREATE UNIQUE INDEX idx_work_pool_bol_unique
  ON job_work_pool(order_detail_id, bol_id)
  WHERE bol_id IS NOT NULL;

CREATE INDEX idx_job_work_pool_order ON job_work_pool(order_id);
CREATE INDEX idx_job_work_pool_org   ON job_work_pool(org_id);

-- RLS
ALTER TABLE job_work_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_work_pool" ON job_work_pool
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_work_pool" ON job_work_pool
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_update_work_pool" ON job_work_pool
  FOR UPDATE USING (public.is_org_member(org_id));

CREATE POLICY "org_delete_work_pool" ON job_work_pool
  FOR DELETE USING (public.is_org_member(org_id));

-- =============================================================================
-- Add work_pool_id FK to job_card_items
-- =============================================================================

ALTER TABLE job_card_items
  ADD COLUMN work_pool_id INTEGER REFERENCES job_work_pool(pool_id);

CREATE INDEX idx_job_card_items_pool ON job_card_items(work_pool_id);

-- =============================================================================
-- View: computes issued and remaining quantities per pool row
-- Issuance state is DERIVED, not stored. This is the single source of truth.
-- =============================================================================

CREATE OR REPLACE VIEW job_work_pool_status AS
SELECT
  p.*,
  COALESCE(agg.issued_qty, 0)    AS issued_qty,
  COALESCE(agg.completed_qty, 0) AS completed_qty,
  p.required_qty - COALESCE(agg.issued_qty, 0) AS remaining_qty
FROM job_work_pool p
LEFT JOIN LATERAL (
  SELECT
    SUM(jci.quantity)            AS issued_qty,
    SUM(jci.completed_quantity)  AS completed_qty
  FROM job_card_items jci
  JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p.pool_id
    AND jc.status  NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled')
) agg ON TRUE;

-- =============================================================================
-- Production exceptions for over-issuance / reconciliation mismatches
-- =============================================================================

CREATE TABLE job_work_pool_exceptions (
  exception_id               BIGSERIAL PRIMARY KEY,
  org_id                     UUID NOT NULL REFERENCES organizations(id),
  order_id                   INTEGER NOT NULL REFERENCES orders(order_id),
  work_pool_id               INTEGER NOT NULL REFERENCES job_work_pool(pool_id) ON DELETE CASCADE,
  exception_type             TEXT NOT NULL
                               CHECK (exception_type IN ('over_issued_override', 'over_issued_after_reconcile')),
  status                     TEXT NOT NULL
                               CHECK (status IN ('open', 'acknowledged', 'resolved')),
  required_qty_snapshot      INTEGER NOT NULL,
  issued_qty_snapshot        INTEGER NOT NULL,
  variance_qty               INTEGER NOT NULL,
  trigger_source             TEXT NOT NULL
                               CHECK (trigger_source IN ('issuance_override', 'order_quantity_change', 'pool_reconcile', 'system')),
  trigger_context            JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by               UUID REFERENCES auth.users(id),
  triggered_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by            UUID REFERENCES auth.users(id),
  acknowledged_at            TIMESTAMPTZ,
  resolution_type            TEXT
                               CHECK (resolution_type IN ('cancel_unstarted_cards', 'move_excess_to_stock', 'accept_overproduction_rework')),
  resolution_notes           TEXT,
  resolved_by                UUID REFERENCES auth.users(id),
  resolved_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_job_work_pool_exceptions_open_unique
  ON job_work_pool_exceptions(work_pool_id, exception_type)
  WHERE status IN ('open', 'acknowledged');

CREATE INDEX idx_job_work_pool_exceptions_queue
  ON job_work_pool_exceptions(org_id, status, exception_type, triggered_at DESC);

ALTER TABLE job_work_pool_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_work_pool_exceptions" ON job_work_pool_exceptions
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_work_pool_exceptions" ON job_work_pool_exceptions
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_update_work_pool_exceptions" ON job_work_pool_exceptions
  FOR UPDATE USING (public.is_org_member(org_id));

-- =============================================================================
-- Exception audit trail (append-only)
-- =============================================================================

CREATE TABLE job_work_pool_exception_activity (
  activity_id                BIGSERIAL PRIMARY KEY,
  exception_id               BIGINT NOT NULL REFERENCES job_work_pool_exceptions(exception_id) ON DELETE CASCADE,
  org_id                     UUID NOT NULL REFERENCES organizations(id),
  event_type                 TEXT NOT NULL
                               CHECK (event_type IN (
                                 'created',
                                 'updated',
                                 'variance_changed',
                                 'acknowledged',
                                 'resolution_selected',
                                 'resolved',
                                 'auto_resolved',
                                 'auto_merged_update',
                                 'override_issued'
                               )),
  performed_by               UUID REFERENCES auth.users(id),
  notes                      TEXT,
  payload                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_work_pool_exception_activity_exception
  ON job_work_pool_exception_activity(exception_id, created_at DESC);

ALTER TABLE job_work_pool_exception_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_work_pool_exception_activity" ON job_work_pool_exception_activity
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_work_pool_exception_activity" ON job_work_pool_exception_activity
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

-- =============================================================================
-- Helper: log exception activity
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_job_work_pool_exception_activity(
  p_exception_id BIGINT,
  p_org_id UUID,
  p_event_type TEXT,
  p_performed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_activity_id BIGINT;
BEGIN
  INSERT INTO job_work_pool_exception_activity (exception_id, org_id, event_type, performed_by, notes, payload)
  VALUES (p_exception_id, p_org_id, p_event_type, p_performed_by, p_notes, p_payload)
  RETURNING activity_id INTO v_activity_id;
  RETURN v_activity_id;
END;
$$;

-- =============================================================================
-- Helper: upsert exception (create or update active exception)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_job_work_pool_exception(
  p_org_id UUID,
  p_order_id INTEGER,
  p_work_pool_id INTEGER,
  p_exception_type TEXT,
  p_status TEXT,
  p_required_qty_snapshot INTEGER,
  p_issued_qty_snapshot INTEGER,
  p_variance_qty INTEGER,
  p_trigger_source TEXT,
  p_trigger_context JSONB DEFAULT '{}'::jsonb,
  p_triggered_by UUID DEFAULT NULL,
  p_acknowledged_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
  v_exception_id BIGINT;
BEGIN
  SELECT * INTO v_existing
  FROM job_work_pool_exceptions
  WHERE work_pool_id = p_work_pool_id
    AND exception_type = p_exception_type
    AND status IN ('open', 'acknowledged')
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    UPDATE job_work_pool_exceptions SET
      required_qty_snapshot = p_required_qty_snapshot,
      issued_qty_snapshot   = p_issued_qty_snapshot,
      variance_qty          = p_variance_qty,
      trigger_context       = p_trigger_context,
      updated_at            = NOW()
    WHERE exception_id = v_existing.exception_id;

    v_exception_id := v_existing.exception_id;

    PERFORM public.log_job_work_pool_exception_activity(
      v_exception_id, p_org_id, 'auto_merged_update', p_triggered_by, p_notes,
      jsonb_build_object(
        'prev_variance', v_existing.variance_qty,
        'new_variance', p_variance_qty,
        'prev_issued', v_existing.issued_qty_snapshot,
        'new_issued', p_issued_qty_snapshot
      )
    );

    IF v_existing.variance_qty != p_variance_qty THEN
      PERFORM public.log_job_work_pool_exception_activity(
        v_exception_id, p_org_id, 'variance_changed', p_triggered_by, NULL,
        jsonb_build_object('from', v_existing.variance_qty, 'to', p_variance_qty)
      );
    END IF;
  ELSE
    INSERT INTO job_work_pool_exceptions (
      org_id, order_id, work_pool_id, exception_type, status,
      required_qty_snapshot, issued_qty_snapshot, variance_qty,
      trigger_source, trigger_context, triggered_by, triggered_at,
      acknowledged_by, acknowledged_at
    ) VALUES (
      p_org_id, p_order_id, p_work_pool_id, p_exception_type, p_status,
      p_required_qty_snapshot, p_issued_qty_snapshot, p_variance_qty,
      p_trigger_source, p_trigger_context, p_triggered_by, NOW(),
      p_acknowledged_by,
      CASE WHEN p_acknowledged_by IS NOT NULL THEN NOW() ELSE NULL END
    )
    RETURNING exception_id INTO v_exception_id;

    PERFORM public.log_job_work_pool_exception_activity(
      v_exception_id, p_org_id, 'created', p_triggered_by, p_notes,
      jsonb_build_object(
        'exception_type', p_exception_type,
        'variance', p_variance_qty,
        'trigger_source', p_trigger_source
      )
    );

    IF p_acknowledged_by IS NOT NULL THEN
      PERFORM public.log_job_work_pool_exception_activity(
        v_exception_id, p_org_id, 'acknowledged', p_acknowledged_by, p_notes,
        jsonb_build_object('acknowledged_at_creation', true)
      );
    END IF;
  END IF;

  RETURN v_exception_id;
END;
$$;

-- =============================================================================
-- Helper: auto-resolve exception if variance cleared
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_job_work_pool_exception_if_cleared(
  p_work_pool_id INTEGER,
  p_exception_type TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing RECORD;
  v_current_issued INTEGER;
  v_pool RECORD;
BEGIN
  SELECT * INTO v_existing
  FROM job_work_pool_exceptions
  WHERE work_pool_id = p_work_pool_id
    AND exception_type = p_exception_type
    AND status IN ('open', 'acknowledged')
  FOR UPDATE;

  IF v_existing IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_pool FROM job_work_pool WHERE pool_id = p_work_pool_id;
  IF v_pool IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(jci.quantity), 0) INTO v_current_issued
  FROM job_card_items jci
  JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p_work_pool_id
    AND jc.status NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled');

  IF v_current_issued <= v_pool.required_qty THEN
    UPDATE job_work_pool_exceptions SET
      status = 'resolved',
      resolved_at = NOW(),
      resolution_type = NULL,
      resolution_notes = 'Auto-resolved: mismatch no longer exists',
      updated_at = NOW()
    WHERE exception_id = v_existing.exception_id;

    PERFORM public.log_job_work_pool_exception_activity(
      v_existing.exception_id, v_existing.org_id, 'auto_resolved', NULL,
      'Mismatch cleared automatically',
      jsonb_build_object(
        'current_issued', v_current_issued,
        'required', v_pool.required_qty,
        'prev_variance', v_existing.variance_qty
      )
    );
  END IF;
END;
$$;

-- =============================================================================
-- Atomic issuance RPC
-- =============================================================================

CREATE OR REPLACE FUNCTION public.issue_job_card_from_pool(
  p_pool_id INTEGER,
  p_quantity INTEGER,
  p_staff_id INTEGER DEFAULT NULL,
  p_allow_overissue BOOLEAN DEFAULT FALSE,
  p_override_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pool        RECORD;
  v_issued_qty  INTEGER;
  v_remaining   INTEGER;
  v_card_id     INTEGER;
  v_caller_org  UUID;
  v_new_variance INTEGER;
BEGIN
  -- Validate caller's org
  SELECT m.org_id INTO v_caller_org
  FROM public.organization_members m
  WHERE m.user_id = auth.uid()
    AND COALESCE(m.is_active, TRUE) = TRUE
  ORDER BY m.inserted_at
  LIMIT 1;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'No organization for current user';
  END IF;

  -- Lock the pool row
  SELECT * INTO v_pool
  FROM job_work_pool
  WHERE pool_id = p_pool_id
  FOR UPDATE;

  IF v_pool IS NULL THEN
    RAISE EXCEPTION 'Work pool entry % not found', p_pool_id;
  END IF;

  IF v_pool.org_id != v_caller_org THEN
    RAISE EXCEPTION 'Access denied: pool belongs to different organization';
  END IF;

  IF v_pool.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot issue from a cancelled pool entry';
  END IF;

  -- Compute current issued quantity
  SELECT COALESCE(SUM(jci.quantity), 0) INTO v_issued_qty
  FROM job_card_items jci
  JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p_pool_id
    AND jc.status  NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled');

  v_remaining := v_pool.required_qty - v_issued_qty;

  IF p_quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;

  IF p_quantity > v_remaining THEN
    IF NOT p_allow_overissue THEN
      RAISE EXCEPTION 'Cannot issue % units - only % remaining in pool', p_quantity, v_remaining;
    END IF;

    IF COALESCE(BTRIM(p_override_reason), '') = '' THEN
      RAISE EXCEPTION 'Override reason is required when issuing beyond remaining quantity';
    END IF;
  END IF;

  -- Create job card
  INSERT INTO job_cards (order_id, staff_id, issue_date, status)
  VALUES (v_pool.order_id, p_staff_id, CURRENT_DATE, 'pending')
  RETURNING job_card_id INTO v_card_id;

  -- Create job card item linked to pool
  INSERT INTO job_card_items (job_card_id, product_id, job_id, quantity, completed_quantity, piece_rate, status, work_pool_id)
  VALUES (v_card_id, v_pool.product_id, v_pool.job_id, p_quantity, 0, v_pool.piece_rate, 'pending', p_pool_id);

  -- Handle exception creation/resolution
  IF p_quantity > v_remaining THEN
    v_new_variance := v_pool.required_qty - (v_issued_qty + p_quantity);

    PERFORM public.upsert_job_work_pool_exception(
      p_org_id => v_pool.org_id,
      p_order_id => v_pool.order_id,
      p_work_pool_id => p_pool_id,
      p_exception_type => 'over_issued_override',
      p_status => 'acknowledged',
      p_required_qty_snapshot => v_pool.required_qty,
      p_issued_qty_snapshot => v_issued_qty + p_quantity,
      p_variance_qty => v_new_variance,
      p_trigger_source => 'issuance_override',
      p_trigger_context => jsonb_build_object(
        'remaining_before_issue', v_remaining,
        'requested_quantity', p_quantity,
        'override_reason', p_override_reason,
        'job_card_id', v_card_id
      ),
      p_triggered_by => auth.uid(),
      p_acknowledged_by => auth.uid(),
      p_notes => p_override_reason
    );
  ELSE
    -- Check if a previous over-issue exception can be auto-resolved
    PERFORM public.resolve_job_work_pool_exception_if_cleared(
      p_work_pool_id => p_pool_id,
      p_exception_type => 'over_issued_override'
    );
  END IF;

  RETURN v_card_id;
END;
$$;
