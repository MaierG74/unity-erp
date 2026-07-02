-- Internal Orders receipts P4.
-- File-only migration: adds receipt origin metadata, makes confirm notes functional,
-- and keeps stock check-in RPC grants aligned with the Phase 4 baseline.

ALTER TABLE public.stock_receipts
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'draft_confirm';

UPDATE public.stock_receipts
SET source = 'draft_confirm'
WHERE source IS NULL;

ALTER TABLE public.stock_receipts
  ALTER COLUMN source SET DEFAULT 'draft_confirm',
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.stock_receipts'::regclass
      AND conname = 'stock_receipts_source_chk'
  ) THEN
    ALTER TABLE public.stock_receipts
      ADD CONSTRAINT stock_receipts_source_chk
      CHECK (source IN ('draft_confirm', 'manual'))
      NOT VALID;
  END IF;
END$$;

ALTER TABLE public.stock_receipts
  VALIDATE CONSTRAINT stock_receipts_source_chk;

DROP FUNCTION IF EXISTS public.confirm_stock_receipt(bigint, uuid, jsonb);

-- ===== confirm a draft stock receipt (with partial-confirmation residual re-draft) =====
CREATE OR REPLACE FUNCTION public.confirm_stock_receipt(p_stock_receipt_id bigint, p_actor uuid DEFAULT NULL, p_item_quantities jsonb DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid; v_order integer; v_status text; v_actor uuid := COALESCE(p_actor, auth.uid());
  v_item record; v_confirm integer; v_residual integer;
  v_confirmed_total integer := 0; v_residuals jsonb := '[]'::jsonb; v_resid jsonb; v_resid_receipt bigint;
  v_notes text := NULLIF(trim(p_notes), '');
BEGIN
  SELECT org_id, order_id, status INTO v_org, v_order, v_status
    FROM public.stock_receipts WHERE stock_receipt_id = p_stock_receipt_id FOR UPDATE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Stock receipt % not found', p_stock_receipt_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Stock receipt % is not a draft (status=%)', p_stock_receipt_id, v_status; END IF;

  FOR v_item IN SELECT * FROM public.stock_receipt_items WHERE stock_receipt_id = p_stock_receipt_id LOOP
    v_confirm := v_item.quantity;
    IF p_item_quantities IS NOT NULL THEN
      SELECT (e->>'quantity')::integer INTO v_confirm
        FROM jsonb_array_elements(p_item_quantities) e
        WHERE (e->>'order_detail_id')::integer = v_item.order_detail_id LIMIT 1;
      v_confirm := COALESCE(v_confirm, v_item.quantity);
    END IF;
    IF v_confirm < 0 OR v_confirm > v_item.quantity THEN
      RAISE EXCEPTION 'Confirm qty % invalid for detail % (max %)', v_confirm, v_item.order_detail_id, v_item.quantity;
    END IF;
    v_residual := v_item.quantity - v_confirm;

    IF v_confirm > 0 THEN
      INSERT INTO public.product_inventory_transactions(product_id, quantity, type, occurred_at, order_id, reference, org_id)
      VALUES (v_item.product_id, v_confirm, 'build', now(), v_order, 'stock_receipts:' || p_stock_receipt_id, v_org);
      UPDATE public.product_inventory SET quantity_on_hand = quantity_on_hand + v_confirm
        WHERE product_id = v_item.product_id AND org_id = v_org;
      IF NOT FOUND THEN
        INSERT INTO public.product_inventory(product_id, quantity_on_hand, org_id) VALUES (v_item.product_id, v_confirm, v_org);
      END IF;
      UPDATE public.order_details
        SET received_qty = received_qty + v_confirm,
            status = CASE WHEN received_qty + v_confirm >= COALESCE(quantity, 0) AND status NOT IN ('cancelled','received')
                          THEN 'received' ELSE status END
        WHERE order_detail_id = v_item.order_detail_id;
      v_confirmed_total := v_confirmed_total + v_confirm;
    END IF;

    IF v_residual > 0 THEN
      v_residuals := v_residuals || jsonb_build_object('detail', v_item.order_detail_id, 'product', v_item.product_id, 'qty', v_residual);
    END IF;

    IF v_confirm = 0 THEN
      DELETE FROM public.stock_receipt_items WHERE stock_receipt_item_id = v_item.stock_receipt_item_id;
    ELSE
      UPDATE public.stock_receipt_items SET quantity = v_confirm WHERE stock_receipt_item_id = v_item.stock_receipt_item_id;
    END IF;
  END LOOP;

  -- confirm the original FIRST so the partial-unique one-draft-per-order index is free for the residual
  UPDATE public.stock_receipts
    SET status = 'confirmed',
        received_at = now(),
        received_by = v_actor,
        notes = CASE
          WHEN v_notes IS NULL THEN notes
          WHEN notes IS NULL OR length(trim(notes)) = 0 THEN v_notes
          ELSE notes || E'\n' || v_notes
        END,
        updated_at = now()
  WHERE stock_receipt_id = p_stock_receipt_id;

  IF jsonb_array_length(v_residuals) > 0 THEN
    INSERT INTO public.stock_receipts(org_id, order_id, receipt_number, status, source, created_by)
    VALUES (v_org, v_order, public.issue_stock_receipt_number(v_org), 'draft', 'draft_confirm', v_actor)
    RETURNING stock_receipt_id INTO v_resid_receipt;
    FOR v_resid IN SELECT * FROM jsonb_array_elements(v_residuals) LOOP
      INSERT INTO public.stock_receipt_items(org_id, stock_receipt_id, order_detail_id, product_id, quantity)
      VALUES (v_org, v_resid_receipt, (v_resid->>'detail')::integer, (v_resid->>'product')::integer, (v_resid->>'qty')::integer);
    END LOOP;
  END IF;

  PERFORM public.check_order_completion(v_order);
  RETURN jsonb_build_object('stock_receipt_id', p_stock_receipt_id, 'confirmed_qty', v_confirmed_total, 'residual_receipt_id', v_resid_receipt);
END$$;

-- ===== manual receive (safety net) — creates a confirmed receipt directly =====
-- UNION body: this migration sorts AFTER 20260702120000_internal_orders_lifecycle_l2_l4.sql,
-- which adds the L3 over-receive guard to this same function. This version must therefore
-- carry the L3 guard (validate-first pass, FOR UPDATE, tightened detail lookup) PLUS the
-- source='manual' stamp, so apply order can never revert either slice's delta.
CREATE OR REPLACE FUNCTION public.create_manual_stock_receipt(p_order_id integer, p_items jsonb, p_notes text, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid; v_type text; v_actor uuid := COALESCE(p_actor, auth.uid());
  v_receipt bigint; v_detail integer; v_product integer; v_qty integer;
  v_ordered integer; v_received integer; v_outstanding integer;
  v_line record;
BEGIN
  IF p_notes IS NULL OR length(trim(p_notes)) = 0 THEN RAISE EXCEPTION 'Manual receipt requires a notes/reason'; END IF;
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'internal' THEN RAISE EXCEPTION 'Manual receipts are only for internal orders'; END IF;

  -- L3: validate every line (with row locks) before any writes
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

  INSERT INTO public.stock_receipts(org_id, order_id, receipt_number, status, received_at, received_by, notes, source, created_by)
  VALUES (v_org, p_order_id, public.issue_stock_receipt_number(v_org), 'confirmed', now(), v_actor, p_notes, 'manual', v_actor)
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
    -- non-ready -> received rule (round-2 MINOR #3): manual receive can land stock on pending/in_production lines
    UPDATE public.order_details
      SET received_qty = received_qty + v_qty,
          status = CASE WHEN received_qty + v_qty >= COALESCE(quantity, 0) AND status NOT IN ('cancelled','received')
                        THEN 'received' ELSE status END
      WHERE order_detail_id = v_detail;
  END LOOP;

  PERFORM public.check_order_completion(p_order_id);
  RETURN v_receipt;
END$$;

REVOKE EXECUTE ON FUNCTION public.confirm_stock_receipt(bigint, uuid, jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_manual_stock_receipt(integer, jsonb, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.confirm_stock_receipt(bigint, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_stock_receipt(integer, jsonb, text, uuid) TO authenticated;
