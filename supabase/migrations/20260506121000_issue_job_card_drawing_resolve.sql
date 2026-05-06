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
SET search_path = public
AS $$
DECLARE
  v_pool        RECORD;
  v_issued_qty  INTEGER;
  v_remaining   INTEGER;
  v_card_id     INTEGER;
  v_caller_org  UUID;
  v_new_variance INTEGER;
  v_drawing_url TEXT;
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

  SELECT odd.drawing_url INTO v_drawing_url
  FROM order_detail_drawings odd
  JOIN job_work_pool jwp
    ON jwp.order_detail_id = odd.order_detail_id
   AND jwp.bol_id = odd.bol_id
  WHERE jwp.pool_id = p_pool_id;

  IF v_drawing_url IS NULL THEN
    SELECT
      CASE
        WHEN bl.drawing_url IS NOT NULL THEN bl.drawing_url
        WHEN bl.use_product_drawing THEN p.configurator_drawing_url
        ELSE NULL
      END
    INTO v_drawing_url
    FROM job_work_pool jwp
    JOIN billoflabour bl ON bl.bol_id = jwp.bol_id
    JOIN products p ON p.product_id = jwp.product_id
    WHERE jwp.pool_id = p_pool_id;
  END IF;

  -- Create job card item linked to pool
  INSERT INTO job_card_items (job_card_id, product_id, job_id, quantity, completed_quantity, piece_rate, status, work_pool_id, drawing_url)
  VALUES (v_card_id, v_pool.product_id, v_pool.job_id, p_quantity, 0, v_pool.piece_rate, 'pending', p_pool_id, v_drawing_url);

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

REVOKE EXECUTE ON FUNCTION public.issue_job_card_from_pool(INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_job_card_from_pool(INTEGER, INTEGER, INTEGER, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
