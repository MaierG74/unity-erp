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
  inv RECORD;
  v_required NUMERIC;
  v_to_take NUMERIC;
  v_consumed NUMERIC;
BEGIN
  -- Snapshot reservations for this order
  FOR r IN (
    SELECT product_id, qty_reserved
    FROM public.product_reservations
    WHERE order_id = p_order_id
    FOR UPDATE
  ) LOOP
    v_required := COALESCE(r.qty_reserved, 0);
    v_consumed := 0;

    IF v_required > 0 THEN
      FOR inv IN (
        SELECT product_inventory_id, COALESCE(quantity_on_hand, 0) AS qty
        FROM public.product_inventory
        WHERE product_id = r.product_id AND COALESCE(quantity_on_hand, 0) > 0
        ORDER BY CASE WHEN location IS NULL THEN 0 ELSE 1 END, product_inventory_id
        FOR UPDATE
      ) LOOP
        EXIT WHEN v_required <= 0;

        v_to_take := LEAST(v_required, inv.qty);
        IF v_to_take > 0 THEN
          UPDATE public.product_inventory
          SET quantity_on_hand = quantity_on_hand - v_to_take
          WHERE product_inventory_id = inv.product_inventory_id;

          v_required := v_required - v_to_take;
          v_consumed := v_consumed + v_to_take;
        END IF;
      END LOOP;
    END IF;

    product_id := r.product_id;
    qty_consumed := v_consumed;
    RETURN NEXT;

    -- If we cannot consume anything else, allow subsequent rows to report zero consumption
  END LOOP;

  -- Clear reservations for this order
  DELETE FROM public.product_reservations WHERE order_id = p_order_id;
END;
$$;
