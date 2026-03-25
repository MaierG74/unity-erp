-- Flat view for server-side filtering in Transactions Explorer.
-- security_invoker = true ensures RLS on inventory_transactions applies.

CREATE OR REPLACE VIEW public.inventory_transactions_enriched
WITH (security_invoker = true) AS
SELECT
  it.transaction_id,
  it.component_id,
  it.quantity,
  it.transaction_date,
  it.order_id,
  it.purchase_order_id,
  it.user_id,
  it.reason,
  it.org_id,
  it.transaction_type_id,
  -- Component
  c.internal_code  AS component_code,
  c.description    AS component_description,
  c.category_id,
  -- Category
  cc.categoryname  AS category_name,
  -- Transaction type
  tt.type_name     AS transaction_type_name,
  -- Purchase order
  po.q_number      AS po_number,
  po.supplier_id,
  -- Supplier
  s.name           AS supplier_name,
  -- Order
  o.order_number
FROM public.inventory_transactions it
LEFT JOIN public.components        c  ON c.component_id        = it.component_id
LEFT JOIN public.component_categories cc ON cc.cat_id           = c.category_id
LEFT JOIN public.transaction_types tt ON tt.transaction_type_id = it.transaction_type_id
LEFT JOIN public.purchase_orders   po ON po.purchase_order_id   = it.purchase_order_id
LEFT JOIN public.suppliers         s  ON s.supplier_id          = po.supplier_id
LEFT JOIN public.orders            o  ON o.order_id             = it.order_id;

-- Grant access to authenticated role (PostgREST)
GRANT SELECT ON public.inventory_transactions_enriched TO authenticated;
