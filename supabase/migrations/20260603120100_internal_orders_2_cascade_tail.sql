-- Phase 2 (2/2): wire the readiness cascade into complete_job_card_v2.
-- Reproduced verbatim from the Phase 1B version with ONE addition: a PERFORM of
-- mark_order_details_ready(p_job_card_id) just before RETURN. Runs in the same transaction
-- (fail-loud per spec). For orders without an order_detail_required_sections snapshot
-- (all historical orders) it is a verified no-op — existing piecework completion is unaffected.
CREATE OR REPLACE FUNCTION public.complete_job_card_v2(p_job_card_id integer, p_items jsonb DEFAULT '[]'::jsonb, p_completed_by_user_id uuid DEFAULT NULL::uuid, p_completion_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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
  v_card_section_id integer;
BEGIN
  SELECT true, jc.order_id, jc.staff_id, jc.due_date, jc.status, o.org_id, jc.section_id
  INTO v_card_exists, v_order_id, v_staff_id, v_due_date, v_card_status, v_order_org_id, v_card_section_id
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
        INSERT INTO public.job_cards (order_id, staff_id, issue_date, due_date, status, notes, section_id)
        VALUES (
          v_order_id,
          NULL,
          v_now::date,
          v_due_date,
          'pending',
          format('Follow-up remainder from job card #%s', p_job_card_id),
          v_card_section_id
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

  -- Phase 2 readiness cascade (same transaction; no-op for orders without a section snapshot).
  PERFORM public.mark_order_details_ready(p_job_card_id);

  RETURN jsonb_build_object(
    'job_card_id', p_job_card_id,
    'completion_type', v_completion_type,
    'follow_up_card_id', v_follow_up_card_id,
    'completion_date', v_completion_date,
    'completed_at', v_now
  );
END;
$function$;
