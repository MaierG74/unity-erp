-- Phase 5 (DB): order completion + reopen + customer delivery-note RPCs.
-- DN signing increments delivered_qty ONLY (no product_inventory_transactions write — customer
-- orders are built-to-order; consume-fg already covers FG-reservation fulfilment, and verification
-- confirmed it writes no ledger row, so there is nothing to double-write).

-- ===== Stage 2 promotion: Completed (status_id 30) =====
CREATE OR REPLACE FUNCTION public.check_order_completion(p_order_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_type text; v_prev integer; v_complete boolean; v_has boolean;
BEGIN
  SELECT order_type, status_id INTO v_type, v_prev FROM public.orders WHERE order_id = p_order_id;
  IF v_type IS NULL THEN RETURN; END IF;
  IF v_prev = 30 THEN RETURN; END IF;
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
END$$;

-- ===== reopen a completed (or auto-closed) order =====
CREATE OR REPLACE FUNCTION public.reopen_order(p_order_id integer, p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_restore integer; v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT org_id, completed_from_status_id INTO v_org, v_restore FROM public.orders WHERE order_id = p_order_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
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
END$$;

-- ===== Unity delivery-note number (per-org locked, prefix-aware) =====
CREATE OR REPLACE FUNCTION public.issue_unity_delivery_note_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_prefix text; v_start integer; v_next integer;
BEGIN
  SELECT delivery_note_prefix, delivery_note_starting_number INTO v_prefix, v_start
  FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  v_prefix := COALESCE(v_prefix, 'DN-');
  v_start  := COALESCE(v_start, 1);
  SELECT COALESCE(MAX((substring(note_number FROM length(v_prefix) + 1))::integer), v_start - 1)
  INTO v_next
  FROM public.order_delivery_notes
  WHERE org_id = p_org_id AND note_number LIKE v_prefix || '%'
    AND substring(note_number FROM length(v_prefix) + 1) ~ '^[0-9]+$';
  v_next := GREATEST(v_next + 1, v_start);
  RETURN v_prefix || lpad(v_next::text, 4, '0');
END$$;

-- ===== DN-item allocation guard (sum across non-cancelled notes <= ordered qty) =====
CREATE OR REPLACE FUNCTION public.enforce_dn_item_allocation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE v_alloc integer; v_ordered integer;
BEGIN
  SELECT COALESCE(quantity, 0) INTO v_ordered FROM public.order_details WHERE order_detail_id = NEW.order_detail_id;
  SELECT COALESCE(SUM(i.quantity), 0) INTO v_alloc
  FROM public.order_delivery_note_items i
  JOIN public.order_delivery_notes n ON n.order_delivery_note_id = i.order_delivery_note_id
  WHERE i.order_detail_id = NEW.order_detail_id
    AND n.status IN ('draft','printed','signed')
    AND i.order_delivery_note_item_id <> COALESCE(NEW.order_delivery_note_item_id, -1);
  IF v_alloc + NEW.quantity > v_ordered THEN
    RAISE EXCEPTION 'Delivery allocation for detail % (% + % > ordered %)', NEW.order_detail_id, v_alloc, NEW.quantity, v_ordered;
  END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_dn_item_allocation ON public.order_delivery_note_items;
CREATE TRIGGER trg_dn_item_allocation
  BEFORE INSERT OR UPDATE ON public.order_delivery_note_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dn_item_allocation();

-- ===== allocated delivery qty helper (computed; UI default = ready_qty - allocated) =====
CREATE OR REPLACE FUNCTION public.order_detail_allocated_delivery_qty(p_order_detail_id integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(i.quantity), 0)::integer
  FROM public.order_delivery_note_items i
  JOIN public.order_delivery_notes n ON n.order_delivery_note_id = i.order_delivery_note_id
  WHERE i.order_detail_id = p_order_detail_id AND n.status IN ('draft','printed','signed');
$$;

-- ===== create a Unity (draft) delivery note =====
CREATE OR REPLACE FUNCTION public.create_unity_delivery_note(p_order_id integer, p_items jsonb, p_delivery_date date DEFAULT NULL, p_notes text DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_type text; v_actor uuid := COALESCE(p_actor, auth.uid()); v_note bigint; v_e jsonb;
BEGIN
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'customer' THEN RAISE EXCEPTION 'Delivery notes are only for customer orders'; END IF;

  INSERT INTO public.order_delivery_notes(org_id, order_id, note_number, source, delivery_date, status, notes, created_by)
  VALUES (v_org, p_order_id, public.issue_unity_delivery_note_number(v_org), 'unity', COALESCE(p_delivery_date, current_date), 'draft', p_notes, v_actor)
  RETURNING order_delivery_note_id INTO v_note;

  FOR v_e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_e->>'quantity')::integer > 0 THEN
      INSERT INTO public.order_delivery_note_items(org_id, order_delivery_note_id, order_detail_id, quantity)
      VALUES (v_org, v_note, (v_e->>'order_detail_id')::integer, (v_e->>'quantity')::integer);
    END IF;
  END LOOP;
  RETURN v_note;
END$$;

CREATE OR REPLACE FUNCTION public.mark_delivery_note_printed(p_note_id bigint, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_status text;
BEGIN
  SELECT org_id, status INTO v_org, v_status FROM public.order_delivery_notes WHERE order_delivery_note_id = p_note_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Delivery note % not found', p_note_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_status NOT IN ('draft','printed') THEN RAISE EXCEPTION 'Cannot print a % note', v_status; END IF;
  UPDATE public.order_delivery_notes SET status = 'printed', updated_at = now() WHERE order_delivery_note_id = p_note_id;
END$$;

-- ===== sign a Unity note: increment delivered_qty, then completion check (no ledger write) =====
CREATE OR REPLACE FUNCTION public.mark_delivery_note_signed(p_note_id bigint, p_signed_by text DEFAULT NULL, p_signed_at timestamptz DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_order integer; v_status text; v_item record;
BEGIN
  SELECT org_id, order_id, status INTO v_org, v_order, v_status
    FROM public.order_delivery_notes WHERE order_delivery_note_id = p_note_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Delivery note % not found', p_note_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_status NOT IN ('draft','printed') THEN RAISE EXCEPTION 'Cannot sign a % note', v_status; END IF;

  UPDATE public.order_delivery_notes
    SET status = 'signed', signed_by = p_signed_by, signed_at = COALESCE(p_signed_at, now()), updated_at = now()
  WHERE order_delivery_note_id = p_note_id;

  FOR v_item IN SELECT order_detail_id, quantity FROM public.order_delivery_note_items WHERE order_delivery_note_id = p_note_id LOOP
    UPDATE public.order_details SET delivered_qty = delivered_qty + v_item.quantity WHERE order_detail_id = v_item.order_detail_id;
  END LOOP;

  PERFORM public.check_order_completion(v_order);
END$$;

-- ===== record an external (Pastel) delivery note: signed immediately =====
CREATE OR REPLACE FUNCTION public.record_external_delivery_note(p_order_id integer, p_external_ref text, p_items jsonb, p_delivery_date date DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_type text; v_actor uuid := COALESCE(p_actor, auth.uid()); v_note bigint; v_e jsonb;
BEGIN
  IF p_external_ref IS NULL OR length(trim(p_external_ref)) = 0 THEN RAISE EXCEPTION 'External reference (Pastel DN) is required'; END IF;
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'customer' THEN RAISE EXCEPTION 'Delivery notes are only for customer orders'; END IF;

  INSERT INTO public.order_delivery_notes(org_id, order_id, external_reference, source, delivery_date, status, signed_at, created_by)
  VALUES (v_org, p_order_id, trim(p_external_ref), 'pastel', COALESCE(p_delivery_date, current_date), 'signed', now(), v_actor)
  RETURNING order_delivery_note_id INTO v_note;

  FOR v_e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_e->>'quantity')::integer > 0 THEN
      INSERT INTO public.order_delivery_note_items(org_id, order_delivery_note_id, order_detail_id, quantity)
      VALUES (v_org, v_note, (v_e->>'order_detail_id')::integer, (v_e->>'quantity')::integer);
      UPDATE public.order_details SET delivered_qty = delivered_qty + (v_e->>'quantity')::integer
        WHERE order_detail_id = (v_e->>'order_detail_id')::integer;
    END IF;
  END LOOP;

  PERFORM public.check_order_completion(p_order_id);
  RETURN v_note;
END$$;

-- ===== cancel a delivery note (signed cancel decrements delivered_qty + reopens if needed) =====
CREATE OR REPLACE FUNCTION public.cancel_delivery_note(p_note_id bigint, p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_order integer; v_status text; v_ostatus integer; v_item record; v_actor uuid := COALESCE(p_actor, auth.uid());
BEGIN
  SELECT org_id, order_id, status INTO v_org, v_order, v_status
    FROM public.order_delivery_notes WHERE order_delivery_note_id = p_note_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Delivery note % not found', p_note_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_status = 'cancelled' THEN RETURN; END IF;

  IF v_status = 'signed' THEN
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
END$$;

REVOKE EXECUTE ON FUNCTION public.create_unity_delivery_note(integer, jsonb, date, text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_external_delivery_note(integer, text, jsonb, date, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.mark_delivery_note_signed(bigint, text, timestamptz, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.cancel_delivery_note(bigint, text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reopen_order(integer, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_unity_delivery_note(integer, jsonb, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_delivery_note(integer, text, jsonb, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_delivery_note_printed(bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_delivery_note_signed(bigint, text, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_delivery_note(bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_order(integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_detail_allocated_delivery_qty(integer) TO authenticated;
