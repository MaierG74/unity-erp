-- Phase 1 backend foundation for piecework completion -> payroll:
-- - preserve completion actor on job cards
-- - track explicit remainder disposition on job card items
-- - keep work-pool math correct without rewriting issuance history
-- - add atomic scheduler reassignment for linked job cards
-- - add v2 completion RPCs for strict remainder-aware completion flows

ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_cards_completion_type_check'
      AND conrelid = 'public.job_cards'::regclass
  ) THEN
    ALTER TABLE public.job_cards
      ADD CONSTRAINT job_cards_completion_type_check
      CHECK (completion_type IS NULL OR completion_type IN ('full', 'partial', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_cards_completed_by_user_id
  ON public.job_cards(completed_by_user_id);

ALTER TABLE public.job_card_items
  ADD COLUMN IF NOT EXISTS remainder_action text,
  ADD COLUMN IF NOT EXISTS remainder_qty integer,
  ADD COLUMN IF NOT EXISTS remainder_reason text,
  ADD COLUMN IF NOT EXISTS remainder_follow_up_card_id integer REFERENCES public.job_cards(job_card_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issued_quantity_snapshot integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_card_items_remainder_action_check'
      AND conrelid = 'public.job_card_items'::regclass
  ) THEN
    ALTER TABLE public.job_card_items
      ADD CONSTRAINT job_card_items_remainder_action_check
      CHECK (
        remainder_action IS NULL OR
        remainder_action IN ('return_to_pool', 'follow_up_card', 'scrap', 'shortage')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_card_items_remainder_qty_check'
      AND conrelid = 'public.job_card_items'::regclass
  ) THEN
    ALTER TABLE public.job_card_items
      ADD CONSTRAINT job_card_items_remainder_qty_check
      CHECK (remainder_qty IS NULL OR remainder_qty >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_card_items_issued_quantity_snapshot_check'
      AND conrelid = 'public.job_card_items'::regclass
  ) THEN
    ALTER TABLE public.job_card_items
      ADD CONSTRAINT job_card_items_issued_quantity_snapshot_check
      CHECK (issued_quantity_snapshot IS NULL OR issued_quantity_snapshot >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_card_items_remainder_action
  ON public.job_card_items(remainder_action);

CREATE INDEX IF NOT EXISTS idx_job_card_items_remainder_follow_up_card_id
  ON public.job_card_items(remainder_follow_up_card_id);

CREATE OR REPLACE FUNCTION public.extract_job_card_id_from_instance(p_job_instance_id text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_match text[];
BEGIN
  v_match := regexp_match(COALESCE(p_job_instance_id, ''), ':card-(\d+)$');
  IF v_match IS NULL OR v_match[1] IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_match[1]::integer;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_job_card_payroll_locked(
  p_staff_id integer,
  p_completion_date date
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_weekly_payroll swp
    WHERE swp.staff_id = p_staff_id
      AND swp.week_start_date <= p_completion_date
      AND swp.week_end_date >= p_completion_date
      AND swp.status IN ('approved', 'paid')
  );
$$;

CREATE OR REPLACE VIEW public.job_work_pool_status AS
SELECT
  p.*,
  COALESCE(agg.issued_qty, 0)    AS issued_qty,
  COALESCE(agg.completed_qty, 0) AS completed_qty,
  p.required_qty - COALESCE(agg.issued_qty, 0) AS remaining_qty
FROM public.job_work_pool p
LEFT JOIN LATERAL (
  SELECT
    SUM(
      CASE
        WHEN jci.remainder_action IN ('return_to_pool', 'follow_up_card')
          THEN GREATEST(
            COALESCE(jci.issued_quantity_snapshot, jci.quantity) - COALESCE(jci.remainder_qty, 0),
            0
          )
        ELSE COALESCE(jci.issued_quantity_snapshot, jci.quantity)
      END
    ) AS issued_qty,
    SUM(jci.completed_quantity) AS completed_qty
  FROM public.job_card_items jci
  JOIN public.job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p.pool_id
    AND jc.status  NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled')
) agg ON TRUE;

CREATE OR REPLACE FUNCTION public.complete_job_card_v2(
  p_job_card_id integer,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_completed_by_user_id uuid DEFAULT NULL,
  p_completion_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_now timestamptz := now();
  v_actor uuid := COALESCE(p_completed_by_user_id, auth.uid());
  v_completion_date date := COALESCE(p_completion_date, v_now::date);
  v_order_org_id uuid;
  v_order_id integer;
  v_staff_id integer;
  v_due_date date;
  v_card_status text;
  v_card_exists boolean;
  v_completion_type text := 'full';
  v_follow_up_card_id integer := NULL;
  v_payload_count integer := 0;
  v_active_item_count integer := 0;
  v_item record;
  v_existing_item record;
  v_remainder_qty integer;
BEGIN
  SELECT true, jc.order_id, jc.staff_id, jc.due_date, jc.status, o.org_id
  INTO v_card_exists, v_order_id, v_staff_id, v_due_date, v_card_status, v_order_org_id
  FROM public.job_cards jc
  LEFT JOIN public.orders o ON o.order_id = jc.order_id
  WHERE jc.job_card_id = p_job_card_id
  FOR UPDATE OF jc;

  IF NOT COALESCE(v_card_exists, false) THEN
    RAISE EXCEPTION 'Job card % not found', p_job_card_id;
  END IF;

  IF v_order_org_id IS NOT NULL AND NOT public.is_org_member(v_order_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  IF public.is_job_card_payroll_locked(v_staff_id, v_completion_date) THEN
    RAISE EXCEPTION 'Payroll is locked for staff % on %', v_staff_id, v_completion_date;
  END IF;

  IF COALESCE(v_card_status, '') = 'completed' THEN
    RAISE EXCEPTION 'Job card % is already completed', p_job_card_id;
  END IF;

  IF p_items IS NULL THEN
    p_items := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Completion payload must be a JSON array';
  END IF;

  SELECT COUNT(*)
  INTO v_active_item_count
  FROM public.job_card_items
  WHERE job_card_id = p_job_card_id
    AND status <> 'cancelled';

  IF jsonb_array_length(p_items) = 0 THEN
    UPDATE public.job_card_items
    SET completed_quantity = quantity,
        status = 'completed',
        completion_time = v_now,
        remainder_action = NULL,
        remainder_qty = NULL,
        remainder_reason = NULL,
        remainder_follow_up_card_id = NULL,
        issued_quantity_snapshot = COALESCE(issued_quantity_snapshot, quantity)
    WHERE job_card_id = p_job_card_id
      AND status <> 'cancelled';
  ELSE
    FOR v_item IN
      SELECT
        (elem->>'item_id')::integer AS item_id,
        (elem->>'completed_quantity')::integer AS completed_quantity,
        NULLIF(trim(elem->>'remainder_action'), '') AS remainder_action,
        NULLIF(trim(elem->>'remainder_reason'), '') AS remainder_reason
      FROM jsonb_array_elements(p_items) elem
    LOOP
      v_payload_count := v_payload_count + 1;

      SELECT *
      INTO v_existing_item
      FROM public.job_card_items
      WHERE item_id = v_item.item_id
        AND job_card_id = p_job_card_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % does not belong to job card %', v_item.item_id, p_job_card_id;
      END IF;

      IF v_existing_item.status = 'cancelled' THEN
        RAISE EXCEPTION 'Item % is cancelled and cannot be completed', v_item.item_id;
      END IF;

      IF v_item.completed_quantity IS NULL OR v_item.completed_quantity < 0 THEN
        RAISE EXCEPTION 'Item % requires a completed quantity >= 0', v_item.item_id;
      END IF;

      IF v_item.completed_quantity > v_existing_item.quantity THEN
        RAISE EXCEPTION 'Item % cannot complete % units when only % were issued',
          v_item.item_id,
          v_item.completed_quantity,
          v_existing_item.quantity;
      END IF;

      v_remainder_qty := v_existing_item.quantity - v_item.completed_quantity;

      IF v_remainder_qty > 0 AND v_item.remainder_action IS NULL THEN
        RAISE EXCEPTION 'Item % is short by % units and requires a remainder action',
          v_item.item_id,
          v_remainder_qty;
      END IF;

      IF v_remainder_qty = 0 AND v_item.remainder_action IS NOT NULL THEN
        RAISE EXCEPTION 'Item % cannot set a remainder action when fully completed', v_item.item_id;
      END IF;

      IF v_item.remainder_action IN ('scrap', 'shortage')
         AND v_item.remainder_reason IS NULL THEN
        RAISE EXCEPTION 'Item % requires a remainder reason for action %',
          v_item.item_id,
          v_item.remainder_action;
      END IF;

      IF v_remainder_qty > 0 THEN
        v_completion_type := 'partial';
      END IF;

      IF v_remainder_qty > 0 AND v_item.remainder_action = 'follow_up_card' AND v_follow_up_card_id IS NULL THEN
        INSERT INTO public.job_cards (order_id, staff_id, issue_date, due_date, status, notes)
        VALUES (
          v_order_id,
          NULL,
          v_now::date,
          v_due_date,
          'pending',
          format('Follow-up remainder from job card #%s', p_job_card_id)
        )
        RETURNING job_card_id INTO v_follow_up_card_id;
      END IF;

      IF v_remainder_qty > 0 AND v_item.remainder_action = 'follow_up_card' THEN
        INSERT INTO public.job_card_items (
          job_card_id,
          product_id,
          job_id,
          quantity,
          completed_quantity,
          piece_rate,
          status,
          notes,
          piece_rate_override,
          work_pool_id
        )
        VALUES (
          v_follow_up_card_id,
          v_existing_item.product_id,
          v_existing_item.job_id,
          v_remainder_qty,
          0,
          v_existing_item.piece_rate,
          'pending',
          format('Follow-up remainder from item #%s', v_existing_item.item_id),
          v_existing_item.piece_rate_override,
          v_existing_item.work_pool_id
        );
      END IF;

      UPDATE public.job_card_items
      SET completed_quantity = v_item.completed_quantity,
          status = 'completed',
          completion_time = v_now,
          remainder_action = CASE WHEN v_remainder_qty > 0 THEN v_item.remainder_action ELSE NULL END,
          remainder_qty = CASE WHEN v_remainder_qty > 0 THEN v_remainder_qty ELSE NULL END,
          remainder_reason = CASE WHEN v_remainder_qty > 0 THEN v_item.remainder_reason ELSE NULL END,
          remainder_follow_up_card_id = CASE
            WHEN v_remainder_qty > 0 AND v_item.remainder_action = 'follow_up_card' THEN v_follow_up_card_id
            ELSE NULL
          END,
          issued_quantity_snapshot = CASE
            WHEN v_remainder_qty > 0 THEN COALESCE(v_existing_item.issued_quantity_snapshot, v_existing_item.quantity)
            ELSE issued_quantity_snapshot
          END
      WHERE item_id = v_existing_item.item_id;
    END LOOP;

    IF v_payload_count <> v_active_item_count THEN
      RAISE EXCEPTION 'Completion payload must include all active items on the card';
    END IF;
  END IF;

  UPDATE public.job_cards
  SET status = 'completed',
      completion_date = v_completion_date,
      completed_by_user_id = v_actor,
      completion_type = v_completion_type,
      updated_at = v_now
  WHERE job_card_id = p_job_card_id;

  RETURN jsonb_build_object(
    'job_card_id', p_job_card_id,
    'completion_type', v_completion_type,
    'follow_up_card_id', v_follow_up_card_id,
    'completion_date', v_completion_date,
    'completed_at', v_now
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_job_card_v2(integer, jsonb, uuid, date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_job_card_v2(integer, jsonb, uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_job_card(p_job_card_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  PERFORM public.complete_job_card_v2(p_job_card_id, '[]'::jsonb, auth.uid(), now()::date);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_job_card(integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_job_card(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_assignment_with_card_v2(
  p_assignment_id integer,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_actual_start timestamptz DEFAULT NULL,
  p_actual_end timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_completed_by_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_org_id uuid;
  v_job_status text;
  v_staff_id integer;
  v_order_id integer;
  v_job_instance_id text;
  v_job_card_id integer;
  v_started_at timestamptz;
  v_start_minutes integer;
  v_end_minutes integer;
  v_actual_start timestamptz;
  v_actual_end timestamptz;
  v_duration integer;
  v_now timestamptz := now();
  v_completion jsonb;
BEGIN
  SELECT
    o.org_id,
    lpa.job_status,
    lpa.staff_id,
    lpa.order_id,
    lpa.job_instance_id,
    lpa.started_at,
    lpa.start_minutes
  INTO
    v_org_id,
    v_job_status,
    v_staff_id,
    v_order_id,
    v_job_instance_id,
    v_started_at,
    v_start_minutes
  FROM public.labor_plan_assignments lpa
  JOIN public.orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id
  FOR UPDATE OF lpa;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;

  IF NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  IF v_job_status NOT IN ('issued', 'in_progress', 'on_hold') THEN
    RAISE EXCEPTION 'Cannot complete assignment with status %', v_job_status;
  END IF;

  UPDATE public.assignment_pause_events
  SET resumed_at = v_now
  WHERE assignment_id = p_assignment_id
    AND resumed_at IS NULL;

  v_actual_start := COALESCE(p_actual_start, v_started_at, v_now);
  v_actual_end := COALESCE(p_actual_end, v_now);

  v_start_minutes := EXTRACT(hour FROM v_actual_start AT TIME ZONE 'Africa/Johannesburg') * 60
                   + EXTRACT(minute FROM v_actual_start AT TIME ZONE 'Africa/Johannesburg');
  v_end_minutes := EXTRACT(hour FROM v_actual_end AT TIME ZONE 'Africa/Johannesburg') * 60
                 + EXTRACT(minute FROM v_actual_end AT TIME ZONE 'Africa/Johannesburg');

  v_duration := public.calculate_working_minutes(v_actual_start, v_actual_end, v_org_id, p_assignment_id);

  v_job_card_id := public.extract_job_card_id_from_instance(v_job_instance_id);

  IF v_job_card_id IS NULL THEN
    SELECT jc.job_card_id
    INTO v_job_card_id
    FROM public.job_cards jc
    WHERE jc.order_id = v_order_id
      AND jc.staff_id = v_staff_id
    ORDER BY jc.created_at DESC
    LIMIT 1;
  END IF;

  IF v_job_card_id IS NOT NULL THEN
    v_completion := public.complete_job_card_v2(
      v_job_card_id,
      p_items,
      COALESCE(p_completed_by_user_id, auth.uid()),
      v_actual_end::date
    );
  END IF;

  UPDATE public.labor_plan_assignments
  SET job_status = 'completed',
      completed_at = v_now,
      actual_start_minutes = v_start_minutes,
      actual_end_minutes = v_end_minutes,
      actual_duration_minutes = v_duration,
      completion_notes = p_notes,
      updated_at = v_now
  WHERE assignment_id = p_assignment_id;

  RETURN jsonb_build_object(
    'assignment_id', p_assignment_id,
    'job_card_id', v_job_card_id,
    'completed_at', v_now,
    'actual_duration_minutes', v_duration,
    'job_card_completion', v_completion
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_assignment_with_card_v2(integer, jsonb, timestamptz, timestamptz, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.complete_assignment_with_card_v2(integer, jsonb, timestamptz, timestamptz, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reassign_scheduled_card(
  p_assignment_id integer,
  p_new_staff_id integer,
  p_assignment_date date DEFAULT NULL,
  p_start_minutes integer DEFAULT NULL,
  p_end_minutes integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_pay_type text DEFAULT NULL,
  p_rate_id integer DEFAULT NULL,
  p_hourly_rate_id integer DEFAULT NULL,
  p_piece_rate_id integer DEFAULT NULL
)
RETURNS public.labor_plan_assignments
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_assignment public.labor_plan_assignments%ROWTYPE;
  v_updated public.labor_plan_assignments%ROWTYPE;
  v_org_id uuid;
  v_job_card_id integer;
BEGIN
  SELECT lpa.*
  INTO v_assignment
  FROM public.labor_plan_assignments lpa
  WHERE lpa.assignment_id = p_assignment_id
  FOR UPDATE OF lpa;

  IF v_assignment.assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found', p_assignment_id;
  END IF;

  SELECT o.org_id
  INTO v_org_id
  FROM public.orders o
  WHERE o.order_id = v_assignment.order_id;

  IF NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  v_job_card_id := public.extract_job_card_id_from_instance(v_assignment.job_instance_id);

  IF p_new_staff_id IS NOT NULL AND p_new_staff_id <> v_assignment.staff_id THEN
    IF v_assignment.started_at IS NOT NULL
       OR COALESCE(v_assignment.job_status, '') IN ('in_progress', 'on_hold', 'completed') THEN
      RAISE EXCEPTION 'In-progress or completed work must be reassigned via transfer';
    END IF;

    IF v_job_card_id IS NOT NULL THEN
      UPDATE public.job_cards
      SET staff_id = p_new_staff_id,
          updated_at = now()
      WHERE job_card_id = v_job_card_id;
    END IF;
  END IF;

  UPDATE public.labor_plan_assignments
  SET staff_id = COALESCE(p_new_staff_id, staff_id),
      assignment_date = COALESCE(p_assignment_date, assignment_date),
      start_minutes = COALESCE(p_start_minutes, start_minutes),
      end_minutes = COALESCE(p_end_minutes, end_minutes),
      status = COALESCE(p_status, status),
      pay_type = COALESCE(p_pay_type, pay_type),
      rate_id = COALESCE(p_rate_id, rate_id),
      hourly_rate_id = COALESCE(p_hourly_rate_id, hourly_rate_id),
      piece_rate_id = COALESCE(p_piece_rate_id, piece_rate_id),
      updated_at = now()
  WHERE assignment_id = p_assignment_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_scheduled_card(integer, integer, date, integer, integer, text, text, integer, integer, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.reassign_scheduled_card(integer, integer, date, integer, integer, text, text, integer, integer, integer) TO authenticated;
