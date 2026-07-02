-- Internal Orders lifecycle completeness slice (L2-L4 + diagnostics)
-- File-only migration: do not apply from local sessions.

-- ===== diagnostics table: org-scoped read, writes only through SECURITY DEFINER RPCs =====
CREATE TABLE IF NOT EXISTS public.order_detail_section_diagnostics (
  order_detail_section_diagnostic_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  order_detail_id integer NOT NULL REFERENCES public.order_details(order_detail_id) ON DELETE CASCADE,
  section_id integer NOT NULL REFERENCES public.factory_sections(section_id),
  kind text NOT NULL CHECK (kind IN ('over_completion','zero_op_section')),
  measured_qty numeric(12,3) NOT NULL,
  required_qty numeric(12,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS odsd_detail_section_kind_uq
  ON public.order_detail_section_diagnostics(order_detail_id, section_id, kind);
CREATE INDEX IF NOT EXISTS odsd_org_detail_idx
  ON public.order_detail_section_diagnostics(org_id, order_detail_id);

ALTER TABLE public.order_detail_section_diagnostics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_detail_section_diagnostics_select_org_member
  ON public.order_detail_section_diagnostics;
CREATE POLICY order_detail_section_diagnostics_select_org_member
  ON public.order_detail_section_diagnostics
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

REVOKE ALL ON public.order_detail_section_diagnostics FROM PUBLIC, anon;
GRANT SELECT ON public.order_detail_section_diagnostics TO authenticated;

-- ===== stock receipt status: add voided replay-safely =====
ALTER TABLE public.stock_receipts DROP CONSTRAINT IF EXISTS stock_receipts_status_check;
ALTER TABLE public.stock_receipts ADD CONSTRAINT stock_receipts_status_check
  CHECK (status IN ('draft','confirmed','cancelled','voided'));

-- ===== L2: void a confirmed internal stock receipt =====
CREATE OR REPLACE FUNCTION public.void_stock_receipt(p_receipt_id bigint, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_order integer;
  v_status text;
  v_ostatus integer;
  v_actor uuid := auth.uid();
  v_item record;
  v_voided_total integer := 0;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Voiding a stock receipt requires a reason';
  END IF;

  SELECT org_id, order_id, status
  INTO v_org, v_order, v_status
  FROM public.stock_receipts
  WHERE stock_receipt_id = p_receipt_id
  FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Stock receipt % not found', p_receipt_id;
  END IF;
  IF NOT public.is_org_member(v_org) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can void a stock receipt';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Stock receipt % is not confirmed (status=%)', p_receipt_id, v_status;
  END IF;

  FOR v_item IN
    SELECT stock_receipt_item_id, order_detail_id, product_id, quantity
    FROM public.stock_receipt_items
    WHERE stock_receipt_id = p_receipt_id
    ORDER BY stock_receipt_item_id
  LOOP
    INSERT INTO public.product_inventory_transactions(product_id, quantity, type, occurred_at, order_id, reference, org_id)
    VALUES (v_item.product_id, -v_item.quantity, 'build', now(), v_order, 'stock_receipts:' || p_receipt_id || ':void', v_org);

    UPDATE public.product_inventory
    SET quantity_on_hand = quantity_on_hand - v_item.quantity
    WHERE product_id = v_item.product_id
      AND org_id = v_org;

    IF NOT FOUND THEN
      INSERT INTO public.product_inventory(product_id, quantity_on_hand, org_id)
      VALUES (v_item.product_id, -v_item.quantity, v_org);
    END IF;

    UPDATE public.order_details od
    SET received_qty = GREATEST(od.received_qty - v_item.quantity, 0),
        status = CASE
          WHEN od.status = 'cancelled' THEN od.status
          WHEN GREATEST(od.received_qty - v_item.quantity, 0) >= COALESCE(od.quantity, 0) THEN 'received'
          WHEN od.ready_qty >= COALESCE(od.quantity, 0) THEN 'ready'
          WHEN od.ready_qty > 0 THEN 'in_production'
          ELSE 'pending'
        END
    WHERE od.order_detail_id = v_item.order_detail_id;

    v_voided_total := v_voided_total + v_item.quantity;
  END LOOP;

  UPDATE public.stock_receipts
  SET status = 'voided',
      notes = concat_ws(E'\n', nullif(notes, ''), 'Voided: ' || trim(p_reason)),
      updated_at = now()
  WHERE stock_receipt_id = p_receipt_id;

  SELECT status_id INTO v_ostatus FROM public.orders WHERE order_id = v_order;
  IF v_ostatus = 30 THEN
    PERFORM public.reopen_order(v_order, 'auto-reopened: stock receipt ' || p_receipt_id || ' voided', v_actor);
  ELSE
    PERFORM public.check_order_completion(v_order);
  END IF;

  RETURN jsonb_build_object(
    'stock_receipt_id', p_receipt_id,
    'order_id', v_order,
    'voided_qty', v_voided_total,
    'voided_by', v_actor
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.void_stock_receipt(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_stock_receipt(bigint, text) TO authenticated;

-- ===== L2: reopen_order from Wave-0 body, plus detail status recompute from counters =====
CREATE OR REPLACE FUNCTION public.reopen_order(p_order_id integer, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org uuid; v_restore integer; v_actor uuid := COALESCE(p_actor, auth.uid()); v_type text;
BEGIN
  SELECT org_id, completed_from_status_id, order_type INTO v_org, v_restore, v_type FROM public.orders WHERE order_id = p_order_id;
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

  UPDATE public.order_details od
  SET status = CASE
    WHEN od.status = 'cancelled' THEN od.status
    WHEN v_type = 'customer' AND od.delivered_qty >= COALESCE(od.quantity, 0) THEN 'delivered'
    WHEN v_type = 'internal' AND od.received_qty >= COALESCE(od.quantity, 0) THEN 'received'
    WHEN od.ready_qty >= COALESCE(od.quantity, 0) THEN 'ready'
    WHEN od.ready_qty > 0 THEN 'in_production'
    ELSE 'pending'
  END
  WHERE od.order_id = p_order_id
    AND od.status <> 'cancelled';
END$function$;

REVOKE EXECUTE ON FUNCTION public.reopen_order(integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_order(integer, text, uuid) TO authenticated;

-- ===== L3: manual receive with clean over-receive guard =====
CREATE OR REPLACE FUNCTION public.create_manual_stock_receipt(p_order_id integer, p_items jsonb, p_notes text, p_actor uuid DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid; v_type text; v_actor uuid := COALESCE(p_actor, auth.uid());
  v_receipt bigint; v_e jsonb; v_detail integer; v_product integer; v_qty integer;
  v_ordered integer; v_received integer; v_outstanding integer;
  v_line record;
BEGIN
  IF p_notes IS NULL OR length(trim(p_notes)) = 0 THEN RAISE EXCEPTION 'Manual receipt requires a notes/reason'; END IF;
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'internal' THEN RAISE EXCEPTION 'Manual receipts are only for internal orders'; END IF;

  FOR v_line IN
    SELECT
      (item->>'order_detail_id')::integer AS order_detail_id,
      SUM((item->>'quantity')::integer) AS quantity
    FROM jsonb_array_elements(p_items) item
    WHERE (item->>'quantity')::integer > 0
    GROUP BY (item->>'order_detail_id')::integer
  LOOP
    v_detail := v_line.order_detail_id;
    v_qty := v_line.quantity;

    SELECT od.product_id, COALESCE(od.quantity, 0), od.received_qty
    INTO v_product, v_ordered, v_received
    FROM public.order_details od
    WHERE od.order_detail_id = v_detail
      AND od.order_id = p_order_id
      AND od.org_id = v_org
    FOR UPDATE;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Order detail % not found on order %', v_detail, p_order_id;
    END IF;

    v_outstanding := GREATEST(v_ordered - v_received, 0);
    IF v_received + v_qty > v_ordered THEN
      RAISE EXCEPTION 'Cannot receive %: only % of % remain outstanding', v_qty, v_outstanding, v_ordered;
    END IF;
  END LOOP;

  INSERT INTO public.stock_receipts(org_id, order_id, receipt_number, status, received_at, received_by, notes, created_by)
  VALUES (v_org, p_order_id, public.issue_stock_receipt_number(v_org), 'confirmed', now(), v_actor, p_notes, v_actor)
  RETURNING stock_receipt_id INTO v_receipt;

  FOR v_line IN
    SELECT
      (item->>'order_detail_id')::integer AS order_detail_id,
      SUM((item->>'quantity')::integer) AS quantity
    FROM jsonb_array_elements(p_items) item
    WHERE (item->>'quantity')::integer > 0
    GROUP BY (item->>'order_detail_id')::integer
  LOOP
    v_detail := v_line.order_detail_id;
    v_qty := v_line.quantity;

    SELECT od.product_id INTO v_product
    FROM public.order_details od
    WHERE od.order_detail_id = v_detail
      AND od.order_id = p_order_id
      AND od.org_id = v_org;

    INSERT INTO public.stock_receipt_items(org_id, stock_receipt_id, order_detail_id, product_id, quantity)
    VALUES (v_org, v_receipt, v_detail, v_product, v_qty);
    INSERT INTO public.product_inventory_transactions(product_id, quantity, type, occurred_at, order_id, reference, org_id)
    VALUES (v_product, v_qty, 'build', now(), p_order_id, 'stock_receipts:' || v_receipt, v_org);
    UPDATE public.product_inventory SET quantity_on_hand = quantity_on_hand + v_qty
      WHERE product_id = v_product AND org_id = v_org;
    IF NOT FOUND THEN
      INSERT INTO public.product_inventory(product_id, quantity_on_hand, org_id) VALUES (v_product, v_qty, v_org);
    END IF;
    UPDATE public.order_details
      SET received_qty = received_qty + v_qty,
          status = CASE WHEN received_qty + v_qty >= COALESCE(quantity, 0) AND status NOT IN ('cancelled','received')
                        THEN 'received' ELSE status END
      WHERE order_detail_id = v_detail;
  END LOOP;

  PERFORM public.check_order_completion(p_order_id);
  RETURN v_receipt;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.create_manual_stock_receipt(integer, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_stock_receipt(integer, jsonb, text, uuid) TO authenticated;

-- ===== L4 + diagnostics: zero-op sections are non-gating and over-completion is visible =====
CREATE OR REPLACE FUNCTION public.mark_order_details_ready(p_job_card_id integer)
RETURNS SETOF integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order_id integer;
  v_org uuid;
  rec record;
  v_new integer;
  v_ordered integer;
BEGIN
  SELECT jc.order_id, o.org_id INTO v_order_id, v_org
  FROM public.job_cards jc LEFT JOIN public.orders o ON o.order_id = jc.order_id
  WHERE jc.job_card_id = p_job_card_id;
  IF v_order_id IS NULL THEN RETURN; END IF;
  IF v_org IS NOT NULL AND NOT public.is_org_member(v_org) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;

  WITH touched AS (
    SELECT DISTINCT jwp.order_detail_id AS detail_id
    FROM public.job_card_items jci
    JOIN public.job_work_pool jwp ON jwp.pool_id = jci.work_pool_id
    WHERE jci.job_card_id = p_job_card_id
      AND jci.work_pool_id IS NOT NULL
      AND jwp.order_detail_id IS NOT NULL
  ),
  op AS (
    SELECT jwp.order_detail_id AS detail_id, jwp.section_id,
           jwp.required_qty, jwp.required_qty_per_finished_good AS mult,
           COALESCE((
             SELECT SUM(jci.completed_quantity) FROM public.job_card_items jci
             JOIN public.job_cards jc ON jc.job_card_id = jci.job_card_id
             WHERE jci.work_pool_id = jwp.pool_id
               AND jc.status <> 'cancelled' AND jci.status <> 'cancelled'
           ), 0) AS completed
    FROM public.job_work_pool jwp
    WHERE jwp.order_detail_id IN (SELECT detail_id FROM touched)
      AND jwp.status <> 'cancelled'
      AND jwp.section_id IS NOT NULL
  ),
  over_sections AS (
    SELECT op.detail_id, op.section_id, MAX(op.completed) AS measured_qty, MAX(op.required_qty) AS required_qty
    FROM op
    WHERE op.completed > op.required_qty
    GROUP BY op.detail_id, op.section_id
  )
  INSERT INTO public.order_detail_section_diagnostics(org_id, order_detail_id, section_id, kind, measured_qty, required_qty)
  SELECT od.org_id, os.detail_id, os.section_id, 'over_completion', os.measured_qty, os.required_qty
  FROM over_sections os
  JOIN public.order_details od ON od.order_detail_id = os.detail_id
  ON CONFLICT (order_detail_id, section_id, kind) DO NOTHING;

  WITH touched AS (
    SELECT DISTINCT jwp.order_detail_id AS detail_id
    FROM public.job_card_items jci
    JOIN public.job_work_pool jwp ON jwp.pool_id = jci.work_pool_id
    WHERE jci.job_card_id = p_job_card_id
      AND jci.work_pool_id IS NOT NULL
      AND jwp.order_detail_id IS NOT NULL
  ),
  op_sections AS (
    SELECT DISTINCT jwp.order_detail_id AS detail_id, jwp.section_id
    FROM public.job_work_pool jwp
    WHERE jwp.order_detail_id IN (SELECT detail_id FROM touched)
      AND jwp.status <> 'cancelled'
      AND jwp.section_id IS NOT NULL
  ),
  zero_sections AS (
    SELECT rs.order_detail_id AS detail_id, rs.section_id, COALESCE(od.quantity, 0) AS required_qty
    FROM public.order_detail_required_sections rs
    JOIN public.order_details od ON od.order_detail_id = rs.order_detail_id
    LEFT JOIN op_sections os ON os.detail_id = rs.order_detail_id AND os.section_id = rs.section_id
    WHERE rs.order_detail_id IN (SELECT detail_id FROM touched)
      AND os.section_id IS NULL
  )
  INSERT INTO public.order_detail_section_diagnostics(org_id, order_detail_id, section_id, kind, measured_qty, required_qty)
  SELECT od.org_id, zs.detail_id, zs.section_id, 'zero_op_section', 0, zs.required_qty
  FROM zero_sections zs
  JOIN public.order_details od ON od.order_detail_id = zs.detail_id
  ON CONFLICT (order_detail_id, section_id, kind) DO NOTHING;

  FOR rec IN
    WITH touched AS (
      SELECT DISTINCT jwp.order_detail_id AS detail_id
      FROM public.job_card_items jci
      JOIN public.job_work_pool jwp ON jwp.pool_id = jci.work_pool_id
      WHERE jci.job_card_id = p_job_card_id
        AND jci.work_pool_id IS NOT NULL
        AND jwp.order_detail_id IS NOT NULL
    ),
    op AS (
      SELECT jwp.order_detail_id AS detail_id, jwp.section_id,
             jwp.required_qty, jwp.required_qty_per_finished_good AS mult,
             COALESCE((
               SELECT SUM(jci.completed_quantity) FROM public.job_card_items jci
               JOIN public.job_cards jc ON jc.job_card_id = jci.job_card_id
               WHERE jci.work_pool_id = jwp.pool_id
                 AND jc.status <> 'cancelled' AND jci.status <> 'cancelled'
             ), 0) AS completed
      FROM public.job_work_pool jwp
      WHERE jwp.order_detail_id IN (SELECT detail_id FROM touched)
        AND jwp.status <> 'cancelled'
        AND jwp.section_id IS NOT NULL
    ),
    op_fg AS (
      SELECT detail_id, section_id,
             FLOOR(LEAST(completed, required_qty)::numeric / NULLIF(mult, 0)) AS op_units
      FROM op
    ),
    sec AS (
      SELECT rs.order_detail_id AS detail_id, rs.section_id,
             COUNT(op_fg.op_units) AS op_count,
             COALESCE(MIN(op_fg.op_units), 0) AS section_units
      FROM public.order_detail_required_sections rs
      LEFT JOIN op_fg ON op_fg.detail_id = rs.order_detail_id AND op_fg.section_id = rs.section_id
      WHERE rs.order_detail_id IN (SELECT detail_id FROM touched)
      GROUP BY rs.order_detail_id, rs.section_id
    ),
    detail_calc AS (
      SELECT s.detail_id,
             MIN(s.section_units) FILTER (WHERE s.op_count > 0) AS min_units,
             COUNT(*) FILTER (WHERE s.op_count > 0) AS gating_section_count
      FROM sec s
      GROUP BY s.detail_id
    )
    SELECT dc.detail_id, dc.min_units, od.quantity AS ordered, od.ready_qty AS old_ready, od.status AS old_status
    FROM detail_calc dc JOIN public.order_details od ON od.order_detail_id = dc.detail_id
    WHERE COALESCE(od.quantity, 0) > 0
      AND dc.gating_section_count > 0
  LOOP
    v_ordered := COALESCE(rec.ordered, 0);
    v_new := LEAST(v_ordered, GREATEST(rec.min_units, 0))::integer;
    IF v_new > rec.old_ready AND rec.old_status <> 'cancelled' THEN
      UPDATE public.order_details
      SET ready_qty = v_new,
          status = CASE WHEN v_new >= v_ordered AND status <> 'cancelled' THEN 'ready' ELSE status END
      WHERE order_detail_id = rec.detail_id AND status <> 'cancelled';
      IF v_new >= v_ordered AND rec.old_status <> 'ready' THEN
        RETURN NEXT rec.detail_id;
      END IF;
    END IF;
  END LOOP;

  PERFORM public.check_order_readiness(v_order_id);
  RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.mark_order_details_ready(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_order_details_ready(integer) TO authenticated;
