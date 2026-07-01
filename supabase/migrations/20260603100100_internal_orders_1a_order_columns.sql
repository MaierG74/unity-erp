-- Phase 1A (2/5): orders + order_details columns & checks (additive, NULLABLE/defaulted).

-- ===== orders =====
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS internal_reason text,
  ADD COLUMN IF NOT EXISTS completed_from_status_id integer;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_order_type_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_order_type_chk CHECK (order_type IN ('customer','internal'));

-- orders_completed_from_status_fk is intentionally NOT created. A second FK from
-- orders to order_statuses breaks un-hinted PostgREST embeds (PGRST201/300); prod
-- dropped it in 20260604065824_hotfix_drop_orders_completed_from_status_fk and the
-- no-FK state is canonical. Drop-only so replay can never reintroduce it.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_completed_from_status_fk;

-- Combined customer/internal invariant: NOT VALID + assert + VALIDATE (round-2 MINOR #5 shape).
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_type_customer_reason_chk;
ALTER TABLE public.orders ADD CONSTRAINT orders_type_customer_reason_chk CHECK (
       (order_type = 'customer' AND customer_id IS NOT NULL AND internal_reason IS NULL)
    OR (order_type = 'internal' AND customer_id IS NULL  AND length(trim(coalesce(internal_reason,''))) > 0)
) NOT VALID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE customer_id IS NULL AND COALESCE(order_type,'customer') = 'customer'
  ) THEN
    RAISE EXCEPTION 'Cannot validate orders_type_customer_reason_chk: customer orders with NULL customer_id exist';
  END IF;
END$$;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_type_customer_reason_chk;

-- ===== order_details =====
ALTER TABLE public.order_details
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ready_qty     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_qty  integer NOT NULL DEFAULT 0;

ALTER TABLE public.order_details DROP CONSTRAINT IF EXISTS order_details_status_chk;
ALTER TABLE public.order_details ADD CONSTRAINT order_details_status_chk
  CHECK (status IN ('pending','in_production','ready','delivered','received','cancelled'));

ALTER TABLE public.order_details DROP CONSTRAINT IF EXISTS order_details_qty_counters_chk;
ALTER TABLE public.order_details ADD CONSTRAINT order_details_qty_counters_chk CHECK (
      ready_qty     <= COALESCE(quantity, 0)
  AND delivered_qty <= COALESCE(quantity, 0)
  AND received_qty  <= COALESCE(quantity, 0)
);
