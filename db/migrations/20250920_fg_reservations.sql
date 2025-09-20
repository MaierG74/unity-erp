-- FG Reservations schema and functions
-- Safe to run multiple times: uses IF NOT EXISTS and CREATE OR REPLACE

-- 1) Ensure product_reservations table exists
CREATE TABLE IF NOT EXISTS public.product_reservations (
  id            BIGSERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  order_id      INTEGER NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  qty_reserved  NUMERIC NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_product_reservations_product_id ON public.product_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_product_reservations_order_id   ON public.product_reservations(order_id);

-- 2) Reserve FG for an order (idempotent)
CREATE OR REPLACE FUNCTION public.reserve_finished_goods(p_order_id INTEGER)
RETURNS TABLE(product_id INTEGER, qty_reserved NUMERIC)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Remove any existing reservations for this order
  DELETE FROM public.product_reservations pr WHERE pr.order_id = p_order_id;

  -- Insert desired reservations based on available stock and return them
  RETURN QUERY
  INSERT INTO public.product_reservations(product_id, order_id, qty_reserved)
  SELECT
    ol.product_id,
    p_order_id,
    GREATEST(0, LEAST(
      ol.order_qty,
      COALESCE(oh.qty, 0) - COALESCE(orv.qty, 0)
    )) AS qty_to_reserve
  FROM (
    SELECT od.product_id, SUM(COALESCE(od.quantity,0))::NUMERIC AS order_qty
    FROM public.order_details od
    WHERE od.order_id = p_order_id
    GROUP BY od.product_id
  ) ol
  LEFT JOIN (
    SELECT pi.product_id, SUM(COALESCE(pi.quantity_on_hand,0))::NUMERIC AS qty
    FROM public.product_inventory pi
    GROUP BY pi.product_id
  ) oh ON oh.product_id = ol.product_id
  LEFT JOIN (
    SELECT pr.product_id, SUM(COALESCE(pr.qty_reserved,0))::NUMERIC AS qty
    FROM public.product_reservations pr
    WHERE pr.order_id <> p_order_id
    GROUP BY pr.product_id
  ) orv ON orv.product_id = ol.product_id
  WHERE GREATEST(0, LEAST(
      ol.order_qty,
      COALESCE(oh.qty, 0) - COALESCE(orv.qty, 0)
  )) > 0
  RETURNING product_id, qty_reserved;
END;
$$;

-- 3) Release FG for an order
CREATE OR REPLACE FUNCTION public.release_finished_goods(p_order_id INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  DELETE FROM public.product_reservations WHERE order_id = p_order_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4) Consume FG for an order: deduct on-hand and clear reservations
CREATE OR REPLACE FUNCTION public.consume_finished_goods(p_order_id INTEGER)
RETURNS TABLE(product_id INTEGER, qty_consumed NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_inv_id INTEGER;
  v_qoh NUMERIC;
  v_new_qoh NUMERIC;
BEGIN
  -- Snapshot reservations for this order
  FOR r IN (
    SELECT product_id, qty_reserved
    FROM public.product_reservations
    WHERE order_id = p_order_id
  ) LOOP
    -- Prefer a primary/null-location row; otherwise any row
    SELECT pi.product_inventory_id, COALESCE(pi.quantity_on_hand,0)
    INTO v_inv_id, v_qoh
    FROM public.product_inventory pi
    WHERE pi.product_id = r.product_id AND pi.location IS NULL
    ORDER BY pi.product_inventory_id
    LIMIT 1;

    IF v_inv_id IS NULL THEN
      SELECT pi.product_inventory_id, COALESCE(pi.quantity_on_hand,0)
      INTO v_inv_id, v_qoh
      FROM public.product_inventory pi
      WHERE pi.product_id = r.product_id
      ORDER BY pi.product_inventory_id
      LIMIT 1;
    END IF;

    IF v_inv_id IS NOT NULL THEN
      v_new_qoh := GREATEST(0, v_qoh - COALESCE(r.qty_reserved,0));
      UPDATE public.product_inventory
      SET quantity_on_hand = v_new_qoh
      WHERE product_inventory_id = v_inv_id;
    END IF;

    -- Return row for this product regardless of whether an inventory row existed
    product_id := r.product_id;
    qty_consumed := COALESCE(r.qty_reserved,0);
    RETURN NEXT;
  END LOOP;

  -- Clear reservations for this order
  DELETE FROM public.product_reservations WHERE order_id = p_order_id;
END;
$$;
