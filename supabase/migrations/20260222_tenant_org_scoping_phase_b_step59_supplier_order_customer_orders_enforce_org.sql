-- Step 59: Enforce org_id constraint on supplier_order_customer_orders

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.supplier_order_customer_orders
    WHERE org_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce org_id on supplier_order_customer_orders: found NULL org_id rows';
  END IF;
END
$$;

ALTER TABLE public.supplier_order_customer_orders
  VALIDATE CONSTRAINT supplier_order_customer_orders_org_id_fkey;

ALTER TABLE public.supplier_order_customer_orders
  ADD CONSTRAINT supplier_order_customer_orders_org_id_not_null
  CHECK (org_id IS NOT NULL) NOT VALID;

ALTER TABLE public.supplier_order_customer_orders
  VALIDATE CONSTRAINT supplier_order_customer_orders_org_id_not_null;

ALTER TABLE public.supplier_order_customer_orders
  ALTER COLUMN org_id SET NOT NULL;
