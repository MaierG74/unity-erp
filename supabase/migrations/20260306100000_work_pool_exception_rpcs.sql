-- =============================================================================
-- RPCs for work pool exception lifecycle (audit-compliant transitions)
-- Fixes: P1-1 (reconciliation missing exception creation)
--        P1-2 (acknowledge/resolve bypassing audit model)
-- =============================================================================

-- =============================================================================
-- 1. Reconcile a work pool row: update required_qty + create/resolve exceptions
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reconcile_work_pool_row(
  p_pool_id INTEGER,
  p_new_required_qty INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pool RECORD;
  v_current_issued INTEGER;
  v_variance INTEGER;
BEGIN
  -- Lock and fetch the pool row
  SELECT * INTO v_pool
  FROM job_work_pool
  WHERE pool_id = p_pool_id
  FOR UPDATE;

  IF v_pool IS NULL THEN
    RAISE EXCEPTION 'Work pool entry % not found', p_pool_id;
  END IF;

  -- Update required_qty
  UPDATE job_work_pool
  SET required_qty = p_new_required_qty, updated_at = NOW()
  WHERE pool_id = p_pool_id;

  -- Compute current issued quantity
  SELECT COALESCE(SUM(jci.quantity), 0) INTO v_current_issued
  FROM job_card_items jci
  JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p_pool_id
    AND jc.status NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled');

  IF v_current_issued > p_new_required_qty THEN
    -- Over-issued after reconcile: create or update exception
    v_variance := p_new_required_qty - v_current_issued;

    PERFORM public.upsert_job_work_pool_exception(
      p_org_id => v_pool.org_id,
      p_order_id => v_pool.order_id,
      p_work_pool_id => p_pool_id,
      p_exception_type => 'over_issued_after_reconcile',
      p_status => 'open',
      p_required_qty_snapshot => p_new_required_qty,
      p_issued_qty_snapshot => v_current_issued,
      p_variance_qty => v_variance,
      p_trigger_source => 'pool_reconcile',
      p_trigger_context => jsonb_build_object(
        'prev_required', v_pool.required_qty,
        'new_required', p_new_required_qty,
        'issued', v_current_issued
      ),
      p_triggered_by => auth.uid()
    );
  ELSE
    -- Mismatch may have cleared: try auto-resolve
    PERFORM public.resolve_job_work_pool_exception_if_cleared(
      p_work_pool_id => p_pool_id,
      p_exception_type => 'over_issued_after_reconcile'
    );
  END IF;
END;
$$;

-- =============================================================================
-- 2. Acknowledge a work pool exception (with audit trail)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acknowledge_work_pool_exception(
  p_exception_id BIGINT,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ex RECORD;
BEGIN
  SELECT * INTO v_ex
  FROM job_work_pool_exceptions
  WHERE exception_id = p_exception_id
    AND status = 'open'
  FOR UPDATE;

  IF v_ex IS NULL THEN
    RAISE EXCEPTION 'Exception % not found or not in open status', p_exception_id;
  END IF;

  UPDATE job_work_pool_exceptions SET
    status = 'acknowledged',
    acknowledged_by = auth.uid(),
    acknowledged_at = NOW(),
    updated_at = NOW()
  WHERE exception_id = p_exception_id;

  PERFORM public.log_job_work_pool_exception_activity(
    v_ex.exception_id, v_ex.org_id, 'acknowledged', auth.uid(), p_notes,
    jsonb_build_object(
      'exception_type', v_ex.exception_type,
      'variance_qty', v_ex.variance_qty
    )
  );
END;
$$;

-- =============================================================================
-- 3. Resolve a work pool exception (with audit trail)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_work_pool_exception(
  p_exception_id BIGINT,
  p_resolution_type TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ex RECORD;
BEGIN
  SELECT * INTO v_ex
  FROM job_work_pool_exceptions
  WHERE exception_id = p_exception_id
    AND status IN ('open', 'acknowledged')
  FOR UPDATE;

  IF v_ex IS NULL THEN
    RAISE EXCEPTION 'Exception % not found or already resolved', p_exception_id;
  END IF;

  UPDATE job_work_pool_exceptions SET
    status = 'resolved',
    resolved_by = auth.uid(),
    resolved_at = NOW(),
    resolution_type = p_resolution_type,
    resolution_notes = p_notes,
    updated_at = NOW()
  WHERE exception_id = p_exception_id;

  PERFORM public.log_job_work_pool_exception_activity(
    v_ex.exception_id, v_ex.org_id, 'resolution_selected', auth.uid(), p_notes,
    jsonb_build_object(
      'resolution_type', p_resolution_type,
      'exception_type', v_ex.exception_type,
      'variance_qty', v_ex.variance_qty
    )
  );

  PERFORM public.log_job_work_pool_exception_activity(
    v_ex.exception_id, v_ex.org_id, 'resolved', auth.uid(), p_notes,
    jsonb_build_object('resolution_type', p_resolution_type)
  );
END;
$$;
