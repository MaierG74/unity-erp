-- Step 60: Enable org-scoped RLS on supplier_order_customer_orders

ALTER TABLE public.supplier_order_customer_orders
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_order_customer_orders_select_org_member
ON public.supplier_order_customer_orders
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_order_customer_orders.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_order_customer_orders_insert_org_member
ON public.supplier_order_customer_orders
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_order_customer_orders.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_order_customer_orders_update_org_member
ON public.supplier_order_customer_orders
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_order_customer_orders.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_order_customer_orders.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

CREATE POLICY supplier_order_customer_orders_delete_org_member
ON public.supplier_order_customer_orders
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = supplier_order_customer_orders.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
