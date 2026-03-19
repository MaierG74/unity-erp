-- Reconcile the live complete_assignment_with_card RPC into repo migration history.
-- The function already exists in the database, but it was introduced outside the
-- tracked supabase/migrations directory.

CREATE OR REPLACE FUNCTION public.complete_assignment_with_card(
  p_assignment_id integer,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_actual_start timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_actual_end timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_org_id UUID;
  v_job_status TEXT;
  v_staff_id INTEGER;
  v_order_id INTEGER;
  v_job_id INTEGER;
  v_job_card_id INTEGER;
  v_started_at TIMESTAMPTZ;
  v_start_minutes INTEGER;
  v_end_minutes INTEGER;
  v_actual_start TIMESTAMPTZ;
  v_actual_end TIMESTAMPTZ;
  v_duration INTEGER;
  v_now TIMESTAMPTZ := now();
  v_item JSONB;
BEGIN
  SELECT o.org_id, lpa.job_status, lpa.staff_id, lpa.order_id, lpa.job_id,
         lpa.started_at, lpa.start_minutes
  INTO v_org_id, v_job_status, v_staff_id, v_order_id, v_job_id, v_started_at, v_start_minutes
  FROM labor_plan_assignments lpa
  JOIN orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;

  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  IF v_job_status NOT IN ('issued', 'in_progress', 'on_hold') THEN
    RAISE EXCEPTION 'Cannot complete assignment with status %', v_job_status;
  END IF;

  -- Close any open pause events
  UPDATE assignment_pause_events
  SET resumed_at = v_now
  WHERE assignment_id = p_assignment_id AND resumed_at IS NULL;

  -- Determine actual times
  v_actual_start := COALESCE(p_actual_start, v_started_at, v_now);
  v_actual_end := COALESCE(p_actual_end, v_now);

  -- Convert to minutes from midnight for the assignment record
  v_start_minutes := EXTRACT(hour FROM v_actual_start AT TIME ZONE 'Africa/Johannesburg') * 60
                   + EXTRACT(minute FROM v_actual_start AT TIME ZONE 'Africa/Johannesburg');
  v_end_minutes := EXTRACT(hour FROM v_actual_end AT TIME ZONE 'Africa/Johannesburg') * 60
                 + EXTRACT(minute FROM v_actual_end AT TIME ZONE 'Africa/Johannesburg');

  -- Calculate working minutes using the multi-day aware function
  v_duration := calculate_working_minutes(v_actual_start, v_actual_end, v_org_id, p_assignment_id);

  -- Update the assignment
  UPDATE labor_plan_assignments SET
    job_status = 'completed',
    completed_at = v_now,
    actual_start_minutes = v_start_minutes,
    actual_end_minutes = v_end_minutes,
    actual_duration_minutes = v_duration,
    completion_notes = p_notes,
    updated_at = v_now
  WHERE assignment_id = p_assignment_id;

  -- Find linked job card
  SELECT jk.job_card_id INTO v_job_card_id
  FROM job_cards jk
  WHERE jk.order_id = v_order_id AND jk.staff_id = v_staff_id
  ORDER BY jk.created_at DESC
  LIMIT 1;

  -- If job card exists, update items and mark complete
  IF v_job_card_id IS NOT NULL THEN
    IF jsonb_array_length(p_items) > 0 THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
      LOOP
        UPDATE job_card_items
        SET completed_quantity = (v_item->>'completed_quantity')::INTEGER,
            status = 'completed',
            completion_time = v_now
        WHERE item_id = (v_item->>'item_id')::INTEGER
          AND job_card_id = v_job_card_id;
      END LOOP;
    END IF;

    UPDATE job_card_items
    SET completed_quantity = quantity,
        status = 'completed',
        completion_time = v_now
    WHERE job_card_id = v_job_card_id
      AND status != 'completed';

    UPDATE job_cards
    SET status = 'completed',
        completion_date = v_now::date
    WHERE job_card_id = v_job_card_id;
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', p_assignment_id,
    'job_card_id', v_job_card_id,
    'completed_at', v_now,
    'actual_duration_minutes', v_duration
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.complete_assignment_with_card(integer, jsonb, timestamptz, timestamptz, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_assignment_with_card(integer, jsonb, timestamptz, timestamptz, text) TO authenticated;
