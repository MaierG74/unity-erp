-- Internal Orders P5: delivery-note concurrency and closed-order guards.
-- File-only migration; do not apply from Codex.

-- ===== Unity delivery-note number (per-org locked, prefix-aware) =====
CREATE OR REPLACE FUNCTION public.issue_unity_delivery_note_number(p_org_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END$function$;

-- ===== create a Unity (draft) delivery note =====
CREATE OR REPLACE FUNCTION public.create_unity_delivery_note(p_order_id integer, p_items jsonb, p_delivery_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_type text;
  v_status_id integer;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_note bigint;
  v_e jsonb;
  v_attempt integer;
  v_max_attempts integer := 5;
BEGIN
  SELECT org_id, order_type, status_id INTO v_org, v_type, v_status_id FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'customer' THEN RAISE EXCEPTION 'Delivery notes are only for customer orders'; END IF;
  IF v_status_id = 30 THEN RAISE EXCEPTION 'Cannot create a delivery note for completed order %', p_order_id; END IF;
  IF v_status_id = 31 THEN RAISE EXCEPTION 'Cannot create a delivery note for cancelled order %', p_order_id; END IF;

  FOR v_attempt IN 1..v_max_attempts LOOP
    BEGIN
      INSERT INTO public.order_delivery_notes(org_id, order_id, note_number, source, delivery_date, status, notes, created_by)
      VALUES (v_org, p_order_id, public.issue_unity_delivery_note_number(v_org), 'unity', COALESCE(p_delivery_date, current_date), 'draft', p_notes, v_actor)
      RETURNING order_delivery_note_id INTO v_note;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= v_max_attempts THEN
        RAISE EXCEPTION 'Could not allocate a unique delivery note number after % attempts', v_max_attempts
          USING ERRCODE = '23505';
      END IF;
    END;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_e->>'quantity')::integer > 0 THEN
      INSERT INTO public.order_delivery_note_items(org_id, order_delivery_note_id, order_detail_id, quantity)
      VALUES (v_org, v_note, (v_e->>'order_detail_id')::integer, (v_e->>'quantity')::integer);
    END IF;
  END LOOP;
  RETURN v_note;
END$function$;

-- ===== record an external (Pastel) delivery note: signed immediately =====
CREATE OR REPLACE FUNCTION public.record_external_delivery_note(p_order_id integer, p_external_ref text, p_items jsonb, p_delivery_date date DEFAULT NULL::date, p_actor uuid DEFAULT NULL::uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_type text;
  v_status_id integer;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_note bigint;
  v_e jsonb;
BEGIN
  IF p_external_ref IS NULL OR length(trim(p_external_ref)) = 0 THEN RAISE EXCEPTION 'External reference (Pastel DN) is required'; END IF;
  SELECT org_id, order_type, status_id INTO v_org, v_type, v_status_id FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'customer' THEN RAISE EXCEPTION 'Delivery notes are only for customer orders'; END IF;
  IF v_status_id = 30 THEN RAISE EXCEPTION 'Cannot record a delivery note for completed order %', p_order_id; END IF;
  IF v_status_id = 31 THEN RAISE EXCEPTION 'Cannot record a delivery note for cancelled order %', p_order_id; END IF;

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
END$function$;

-- Wave-0 follow-up: the number issuer still had anon/PUBLIC EXECUTE live (it was
-- not in the Wave-0 revoke list). SECURITY DEFINER + FOR UPDATE on organizations
-- must not be unauthenticated-callable; internal callers run as owner regardless.
REVOKE EXECUTE ON FUNCTION public.issue_unity_delivery_note_number(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_unity_delivery_note_number(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_unity_delivery_note(integer, jsonb, date, text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.record_external_delivery_note(integer, text, jsonb, date, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_unity_delivery_note(integer, jsonb, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_external_delivery_note(integer, text, jsonb, date, uuid) TO authenticated;
