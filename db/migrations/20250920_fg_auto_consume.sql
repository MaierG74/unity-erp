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
  inv record;
  v_apply numeric;
  v_to_take numeric;
  v_consumed numeric;
BEGIN
  IF v_left <= 0 THEN
    RETURN;
  END IF;

  FOR r IN (
    SELECT id, order_id, qty_reserved
    FROM public.product_reservations
    WHERE product_id = p_product_id AND qty_reserved > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  ) LOOP
    EXIT WHEN v_left <= 0;

    v_apply := LEAST(v_left, r.qty_reserved);
    v_consumed := 0;

    FOR inv IN (
      SELECT product_inventory_id, COALESCE(quantity_on_hand, 0) AS qty
      FROM public.product_inventory
      WHERE product_id = p_product_id AND COALESCE(quantity_on_hand, 0) > 0
      ORDER BY CASE WHEN location IS NULL THEN 0 ELSE 1 END, product_inventory_id
      FOR UPDATE
    ) LOOP
      EXIT WHEN v_apply <= 0;

      v_to_take := LEAST(v_apply, inv.qty);
      IF v_to_take > 0 THEN
        UPDATE public.product_inventory
        SET quantity_on_hand = quantity_on_hand - v_to_take
        WHERE product_inventory_id = inv.product_inventory_id;

        v_apply := v_apply - v_to_take;
        v_consumed := v_consumed + v_to_take;
      END IF;
    END LOOP;

    IF v_consumed > 0 THEN
      UPDATE public.product_reservations
      SET qty_reserved = GREATEST(0, qty_reserved - v_consumed)
      WHERE id = r.id;

      order_id := r.order_id;
      qty_applied := v_consumed;
      v_left := v_left - v_consumed;
      RETURN NEXT;
    END IF;

    -- No remaining inventory to apply against reservations
    EXIT;
  END LOOP;
END;
$$;
