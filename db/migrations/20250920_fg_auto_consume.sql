-- Add global setting and auto-consume RPC for Finished Goods

-- 1) Add toggle column to settings table (quote_company_settings used by UI)
ALTER TABLE public.quote_company_settings
ADD COLUMN IF NOT EXISTS fg_auto_consume_on_add boolean NOT NULL DEFAULT false;

-- 2) Auto-consume on add: allocate added FG against reservations FIFO and decrement on-hand
CREATE OR REPLACE FUNCTION public.auto_consume_on_add(p_product_id integer, p_quantity numeric)
RETURNS TABLE(order_id integer, qty_applied numeric)
LANGUAGE plpgsql
AS $$
DECLARE
  v_left numeric := COALESCE(p_quantity, 0);
  r record;
  v_inv_id integer;
  v_qoh numeric;
  v_new_qoh numeric;
  v_apply numeric;
BEGIN
  IF v_left <= 0 THEN
    RETURN;
  END IF;

  FOR r IN (
    SELECT id, order_id, qty_reserved
    FROM public.product_reservations
    WHERE product_id = p_product_id
    ORDER BY created_at ASC, id ASC
  ) LOOP
    EXIT WHEN v_left <= 0;
    IF COALESCE(r.qty_reserved,0) <= 0 THEN
      CONTINUE;
    END IF;

    v_apply := LEAST(v_left, r.qty_reserved);

    -- Reduce reservation
    UPDATE public.product_reservations
    SET qty_reserved = GREATEST(0, qty_reserved - v_apply)
    WHERE id = r.id;

    -- Find inventory row (prefer null location)
    SELECT pi.product_inventory_id, COALESCE(pi.quantity_on_hand,0)
    INTO v_inv_id, v_qoh
    FROM public.product_inventory pi
    WHERE pi.product_id = p_product_id AND pi.location IS NULL
    ORDER BY pi.product_inventory_id
    LIMIT 1;

    IF v_inv_id IS NULL THEN
      SELECT pi.product_inventory_id, COALESCE(pi.quantity_on_hand,0)
      INTO v_inv_id, v_qoh
      FROM public.product_inventory pi
      WHERE pi.product_id = p_product_id
      ORDER BY pi.product_inventory_id
      LIMIT 1;
    END IF;

    IF v_inv_id IS NOT NULL THEN
      v_new_qoh := GREATEST(0, v_qoh - v_apply);
      UPDATE public.product_inventory
      SET quantity_on_hand = v_new_qoh
      WHERE product_inventory_id = v_inv_id;
    END IF;

    order_id := r.order_id;
    qty_applied := v_apply;
    v_left := v_left - v_apply;
    RETURN NEXT;
  END LOOP;
END;
$$;
