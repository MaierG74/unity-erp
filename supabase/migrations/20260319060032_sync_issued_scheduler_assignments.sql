-- Keep issued card-backed assignments in sync with the factory-floor lifecycle view.
-- The "Issue & Schedule" flow creates card-backed job_instance_id values, so these
-- rows must persist job_status/issued_at on labor_plan_assignments for Floor to render them.

-- Backfill existing card-backed assignments that were created before the lifecycle sync fix.
UPDATE public.labor_plan_assignments lpa
SET job_status = 'issued',
    issued_at = COALESCE(lpa.issued_at, now()),
    updated_at = now()
WHERE lpa.job_status IS NULL
  AND public.extract_job_card_id_from_instance(lpa.job_instance_id) IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.job_cards jc
    WHERE jc.job_card_id = public.extract_job_card_id_from_instance(lpa.job_instance_id)
      AND jc.status <> 'cancelled'
  );

CREATE OR REPLACE FUNCTION public.assign_scheduled_card(
  p_job_instance_id text,
  p_order_id integer,
  p_order_detail_id integer DEFAULT NULL,
  p_bol_id integer DEFAULT NULL,
  p_job_id integer DEFAULT NULL,
  p_staff_id integer DEFAULT NULL,
  p_assignment_date date DEFAULT NULL,
  p_start_minutes integer DEFAULT NULL,
  p_end_minutes integer DEFAULT NULL,
  p_status text DEFAULT 'scheduled',
  p_pay_type text DEFAULT 'hourly',
  p_rate_id integer DEFAULT NULL,
  p_hourly_rate_id integer DEFAULT NULL,
  p_piece_rate_id integer DEFAULT NULL,
  p_job_status text DEFAULT NULL
)
RETURNS public.labor_plan_assignments
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org_id uuid;
  v_job_card_id integer;
  v_card_status text;
  v_assignment public.labor_plan_assignments%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Order id is required when scheduling a job';
  END IF;

  SELECT o.org_id
  INTO v_org_id
  FROM public.orders o
  WHERE o.order_id = p_order_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Order % not found or has no linked organisation', p_order_id;
  END IF;

  IF NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  v_job_card_id := public.extract_job_card_id_from_instance(p_job_instance_id);

  IF v_job_card_id IS NOT NULL THEN
    SELECT jc.status
    INTO v_card_status
    FROM public.job_cards jc
    WHERE jc.job_card_id = v_job_card_id
    FOR UPDATE OF jc;

    IF v_card_status IS NULL THEN
      RAISE EXCEPTION 'Job card % not found for assignment %', v_job_card_id, p_job_instance_id;
    END IF;

    IF COALESCE(v_card_status, '') IN ('in_progress', 'completed') THEN
      RAISE EXCEPTION 'Started or completed work must be transferred instead of reassigned';
    END IF;

    UPDATE public.job_cards
    SET staff_id = p_staff_id,
        updated_at = v_now
    WHERE job_card_id = v_job_card_id;
  END IF;

  INSERT INTO public.labor_plan_assignments (
    job_instance_id,
    order_id,
    order_detail_id,
    bol_id,
    job_id,
    staff_id,
    assignment_date,
    start_minutes,
    end_minutes,
    status,
    pay_type,
    rate_id,
    hourly_rate_id,
    piece_rate_id,
    job_status,
    issued_at,
    updated_at
  )
  VALUES (
    p_job_instance_id,
    p_order_id,
    p_order_detail_id,
    p_bol_id,
    p_job_id,
    p_staff_id,
    p_assignment_date,
    p_start_minutes,
    p_end_minutes,
    COALESCE(p_status, 'scheduled'),
    COALESCE(p_pay_type, 'hourly'),
    p_rate_id,
    p_hourly_rate_id,
    p_piece_rate_id,
    p_job_status,
    CASE
      WHEN p_job_status = 'issued' THEN v_now
      ELSE NULL
    END,
    v_now
  )
  ON CONFLICT (job_instance_id, assignment_date)
  DO UPDATE
  SET order_id = EXCLUDED.order_id,
      order_detail_id = EXCLUDED.order_detail_id,
      bol_id = EXCLUDED.bol_id,
      job_id = EXCLUDED.job_id,
      staff_id = EXCLUDED.staff_id,
      start_minutes = EXCLUDED.start_minutes,
      end_minutes = EXCLUDED.end_minutes,
      status = EXCLUDED.status,
      pay_type = EXCLUDED.pay_type,
      rate_id = EXCLUDED.rate_id,
      hourly_rate_id = EXCLUDED.hourly_rate_id,
      piece_rate_id = EXCLUDED.piece_rate_id,
      job_status = EXCLUDED.job_status,
      issued_at = CASE
        WHEN EXCLUDED.job_status = 'issued'
          THEN COALESCE(public.labor_plan_assignments.issued_at, EXCLUDED.issued_at, v_now)
        ELSE public.labor_plan_assignments.issued_at
      END,
      updated_at = v_now
  RETURNING * INTO v_assignment;

  RETURN v_assignment;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_scheduled_card(text, integer, integer, integer, integer, integer, date, integer, integer, text, text, integer, integer, integer, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.assign_scheduled_card(text, integer, integer, integer, integer, integer, date, integer, integer, text, text, integer, integer, integer, text) TO authenticated;
