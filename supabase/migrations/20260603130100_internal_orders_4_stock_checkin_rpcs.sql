-- Phase 4 (DB): stock check-in RPCs. All SECURITY DEFINER, anon revoked.
-- type='build' for receipts (manufactured into stock), type='adjust' for adjustments.
-- reference = '<table>:<id>'. check_order_completion is created in Phase 5 (5_completion_rpcs)
-- which is applied immediately after this file; these functions late-bind to it.

-- ===== confirm a draft stock receipt (with partial-confirmation residual re-draft) =====
CREATE OR REPLACE FUNCTION public.confirm_stock_receipt(p_stock_receipt_id bigint, p_actor uuid DEFAULT NULL, p_item_quantities jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid; v_order integer; v_status text; v_actor uuid := COALESCE(p_actor, auth.uid());
  v_item record; v_confirm integer; v_residual integer;
  v_confirmed_total integer := 0; v_residuals jsonb := '[]'::jsonb; v_resid jsonb; v_resid_receipt bigint;
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
    SET status = 'confirmed', received_at = now(), received_by = v_actor, updated_at = now()
  WHERE stock_receipt_id = p_stock_receipt_id;

  IF jsonb_array_length(v_residuals) > 0 THEN
    INSERT INTO public.stock_receipts(org_id, order_id, receipt_number, status, created_by)
    VALUES (v_org, v_order, public.issue_stock_receipt_number(v_org), 'draft', v_actor)
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
CREATE OR REPLACE FUNCTION public.create_manual_stock_receipt(p_order_id integer, p_items jsonb, p_notes text, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid; v_type text; v_actor uuid := COALESCE(p_actor, auth.uid());
  v_receipt bigint; v_e jsonb; v_detail integer; v_product integer; v_qty integer;
BEGIN
  IF p_notes IS NULL OR length(trim(p_notes)) = 0 THEN RAISE EXCEPTION 'Manual receipt requires a notes/reason'; END IF;
  SELECT org_id, order_type INTO v_org, v_type FROM public.orders WHERE order_id = p_order_id FOR SHARE;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_type <> 'internal' THEN RAISE EXCEPTION 'Manual receipts are only for internal orders'; END IF;

  INSERT INTO public.stock_receipts(org_id, order_id, receipt_number, status, received_at, received_by, notes, created_by)
  VALUES (v_org, p_order_id, public.issue_stock_receipt_number(v_org), 'confirmed', now(), v_actor, p_notes, v_actor)
  RETURNING stock_receipt_id INTO v_receipt;

  FOR v_e IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_detail := (v_e->>'order_detail_id')::integer;
    v_qty    := (v_e->>'quantity')::integer;
    SELECT product_id INTO v_product FROM public.order_details WHERE order_detail_id = v_detail;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
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

-- ===== stock adjustment (raw QOH lever) =====
CREATE OR REPLACE FUNCTION public.apply_stock_adjustment(p_product_id integer, p_delta numeric, p_reason text, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_actor uuid := COALESCE(p_actor, auth.uid()); v_id bigint;
BEGIN
  IF p_delta = 0 THEN RAISE EXCEPTION 'Adjustment delta must be non-zero'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'Adjustment requires a reason'; END IF;
  SELECT org_id INTO v_org FROM public.products WHERE product_id = p_product_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Product % not found', p_product_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO public.stock_adjustments(org_id, product_id, quantity_delta, reason, adjusted_by)
  VALUES (v_org, p_product_id, p_delta, p_reason, v_actor) RETURNING stock_adjustment_id INTO v_id;
  INSERT INTO public.product_inventory_transactions(product_id, quantity, type, occurred_at, reference, org_id)
  VALUES (p_product_id, p_delta, 'adjust', now(), 'stock_adjustments:' || v_id, v_org);
  UPDATE public.product_inventory SET quantity_on_hand = quantity_on_hand + p_delta
    WHERE product_id = p_product_id AND org_id = v_org;
  IF NOT FOUND THEN
    INSERT INTO public.product_inventory(product_id, quantity_on_hand, org_id) VALUES (p_product_id, p_delta, v_org);
  END IF;
  RETURN v_id;
END$$;

-- ===== reverse a stock adjustment =====
CREATE OR REPLACE FUNCTION public.reverse_stock_adjustment(p_adjustment_id bigint, p_actor uuid DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_org uuid; v_product integer; v_delta numeric; v_actor uuid := COALESCE(p_actor, auth.uid()); v_id bigint;
BEGIN
  SELECT org_id, product_id, quantity_delta INTO v_org, v_product, v_delta
    FROM public.stock_adjustments WHERE stock_adjustment_id = p_adjustment_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Adjustment % not found', p_adjustment_id; END IF;
  IF NOT public.is_org_member(v_org) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF EXISTS (SELECT 1 FROM public.stock_adjustments WHERE reverses_adjustment_id = p_adjustment_id) THEN
    RAISE EXCEPTION 'Adjustment % is already reversed', p_adjustment_id;
  END IF;

  INSERT INTO public.stock_adjustments(org_id, product_id, quantity_delta, reason, reverses_adjustment_id, adjusted_by)
  VALUES (v_org, v_product, -v_delta, 'Reversal of adjustment ' || p_adjustment_id, p_adjustment_id, v_actor)
  RETURNING stock_adjustment_id INTO v_id;
  INSERT INTO public.product_inventory_transactions(product_id, quantity, type, occurred_at, reference, org_id)
  VALUES (v_product, -v_delta, 'adjust', now(), 'stock_adjustments:' || v_id, v_org);
  UPDATE public.product_inventory SET quantity_on_hand = quantity_on_hand - v_delta
    WHERE product_id = v_product AND org_id = v_org;
  IF NOT FOUND THEN
    INSERT INTO public.product_inventory(product_id, quantity_on_hand, org_id) VALUES (v_product, -v_delta, v_org);
  END IF;
  RETURN v_id;
END$$;

REVOKE EXECUTE ON FUNCTION public.confirm_stock_receipt(bigint, uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_manual_stock_receipt(integer, jsonb, text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.apply_stock_adjustment(integer, numeric, text, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reverse_stock_adjustment(bigint, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.confirm_stock_receipt(bigint, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_stock_receipt(integer, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stock_adjustment(integer, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_stock_adjustment(bigint, uuid) TO authenticated;
