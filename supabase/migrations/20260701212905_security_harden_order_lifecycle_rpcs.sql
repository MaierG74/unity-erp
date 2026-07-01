-- Wave-0 security hotfix (internal-orders shippability remediation)
-- 1) Internal SECURITY DEFINER helpers must not be callable unauthenticated.
--    They are only invoked from inside gated RPCs/triggers (which execute as the
--    function owner), so revoking anon/PUBLIC breaks no legitimate caller.
REVOKE EXECUTE ON FUNCTION public.check_order_completion(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_order_readiness(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_order_sections(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_order_detail_sections(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.order_detail_allocated_delivery_qty(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_delivery_note_printed(bigint, uuid) FROM PUBLIC, anon;

-- 2) check_order_completion: a cancelled order (31) must never be auto-completed,
--    even if its details are fully delivered/received.
CREATE OR REPLACE FUNCTION public.check_order_completion(p_order_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_type text; v_prev integer; v_complete boolean; v_has boolean;
BEGIN
  SELECT order_type, status_id INTO v_type, v_prev FROM public.orders WHERE order_id = p_order_id;
  IF v_type IS NULL THEN RETURN; END IF;
  IF v_prev IN (30, 31) THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM public.order_details WHERE order_id = p_order_id AND status <> 'cancelled') INTO v_has;
  IF NOT v_has THEN RETURN; END IF;
  IF v_type = 'customer' THEN
    SELECT NOT EXISTS (SELECT 1 FROM public.order_details
      WHERE order_id = p_order_id AND status <> 'cancelled' AND delivered_qty < COALESCE(quantity, 0)) INTO v_complete;
  ELSE
    SELECT NOT EXISTS (SELECT 1 FROM public.order_details
      WHERE order_id = p_order_id AND status <> 'cancelled' AND received_qty < COALESCE(quantity, 0)) INTO v_complete;
  END IF;
  IF v_complete THEN
    PERFORM set_config('app.order_status_trigger_source', 'auto_completed', true);
    PERFORM set_config('app.order_status_reason',
      CASE WHEN v_type = 'customer' THEN 'all lines delivered' ELSE 'all lines received into stock' END, true);
    UPDATE public.orders SET status_id = 30, completed_from_status_id = v_prev
     WHERE order_id = p_order_id AND status_id <> 30;
    PERFORM set_config('app.order_status_trigger_source', '', true);
    PERFORM set_config('app.order_status_reason', '', true);
    IF v_type = 'customer' THEN
      UPDATE public.order_details SET status = 'delivered'
       WHERE order_id = p_order_id AND status NOT IN ('cancelled','delivered') AND delivered_qty >= COALESCE(quantity, 0);
    ELSE
      UPDATE public.order_details SET status = 'received'
       WHERE order_id = p_order_id AND status NOT IN ('cancelled','received') AND received_qty >= COALESCE(quantity, 0);
    END IF;
  END IF;
END$function$;

-- 3) reopen_order: end-user sessions must be admin. Backend callers without a
--    user JWT (service_role, owner) bypass the gate; org membership still applies.
CREATE OR REPLACE FUNCTION public.reopen_order(p_order_id integer, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org uuid; v_restore integer; v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT org_id, completed_from_status_id INTO v_org, v_restore FROM public.orders WHERE order_id = p_order_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reopen a completed order';
  END IF;
  IF v_restore IS NULL THEN
    SELECT to_status_id INTO v_restore FROM public.order_status_events
     WHERE order_id = p_order_id AND to_status_id <> 30 ORDER BY changed_at DESC LIMIT 1;
  END IF;
  v_restore := COALESCE(v_restore, 28);
  PERFORM set_config('app.order_status_trigger_source', 'reopen', true);
  PERFORM set_config('app.order_status_reason', COALESCE(p_reason, 'reopened'), true);
  PERFORM set_config('app.actor_id', COALESCE(v_actor::text, ''), true);
  UPDATE public.orders SET status_id = v_restore, completed_from_status_id = NULL WHERE order_id = p_order_id;
  PERFORM set_config('app.order_status_trigger_source', '', true);
  PERFORM set_config('app.order_status_reason', '', true);
  PERFORM set_config('app.actor_id', '', true);
END$function$;

-- 4) cancel_delivery_note: cancelling a SIGNED note (which unwinds delivered
--    quantities and can reopen the order) requires admin; drafts stay staff-cancellable.
CREATE OR REPLACE FUNCTION public.cancel_delivery_note(p_note_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org uuid; v_order integer; v_status text; v_ostatus integer; v_item record; v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT org_id, order_id, status INTO v_org, v_order, v_status
    FROM public.order_delivery_notes WHERE order_delivery_note_id = p_note_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Delivery note % not found', p_note_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_status = 'cancelled' THEN RETURN; END IF;

  IF v_status = 'signed' THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can cancel a signed delivery note';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Cancelling a signed note requires a reason'; END IF;
    FOR v_item IN SELECT order_detail_id, quantity FROM public.order_delivery_note_items WHERE order_delivery_note_id = p_note_id LOOP
      UPDATE public.order_details
        SET delivered_qty = GREATEST(delivered_qty - v_item.quantity, 0),
            status = CASE WHEN status = 'delivered' AND (delivered_qty - v_item.quantity) < COALESCE(quantity, 0) THEN 'ready' ELSE status END
        WHERE order_detail_id = v_item.order_detail_id;
    END LOOP;
    SELECT status_id INTO v_ostatus FROM public.orders WHERE order_id = v_order;
    IF v_ostatus = 30 THEN
      PERFORM public.reopen_order(v_order, 'auto-reopened: signed delivery note ' || p_note_id || ' cancelled', v_actor);
    END IF;
  END IF;

  UPDATE public.order_delivery_notes SET status = 'cancelled', updated_at = now() WHERE order_delivery_note_id = p_note_id;
END$function$;
