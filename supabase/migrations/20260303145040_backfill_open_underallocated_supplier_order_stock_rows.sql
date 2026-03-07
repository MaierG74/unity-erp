-- Backfill legacy supplier-order allocation gaps that block receiving.
-- Scope: only lines that already have allocation rows, are still open, and whose
-- allocation totals are lower than the supplier order quantity. For those rows,
-- add the missing remainder as stock allocation so receipt caps match the line.

WITH underallocated_open_lines AS (
  SELECT
    so.order_id AS supplier_order_id,
    so.org_id,
    sc.component_id,
    so.order_quantity,
    COALESCE(so.total_received, 0) AS total_received,
    COALESCE(
      SUM(COALESCE(soco.quantity_for_order, 0) + COALESCE(soco.quantity_for_stock, 0)),
      0
    ) AS allocation_total
  FROM public.supplier_orders so
  JOIN public.suppliercomponents sc
    ON sc.supplier_component_id = so.supplier_component_id
  JOIN public.supplier_order_customer_orders existing_alloc
    ON existing_alloc.supplier_order_id = so.order_id
  LEFT JOIN public.supplier_order_customer_orders soco
    ON soco.supplier_order_id = so.order_id
  GROUP BY
    so.order_id,
    so.org_id,
    sc.component_id,
    so.order_quantity,
    so.total_received
  HAVING
    COALESCE(so.total_received, 0) < COALESCE(so.order_quantity, 0)
    AND COALESCE(
      SUM(COALESCE(soco.quantity_for_order, 0) + COALESCE(soco.quantity_for_stock, 0)),
      0
    ) < COALESCE(so.order_quantity, 0)
),
updated_stock_rows AS (
  UPDATE public.supplier_order_customer_orders soco
  SET quantity_for_stock = COALESCE(soco.quantity_for_stock, 0)
    + (uol.order_quantity - uol.allocation_total)
  FROM underallocated_open_lines uol
  WHERE soco.supplier_order_id = uol.supplier_order_id
    AND soco.order_id IS NULL
  RETURNING soco.supplier_order_id
)
INSERT INTO public.supplier_order_customer_orders (
  supplier_order_id,
  order_id,
  component_id,
  quantity_for_order,
  quantity_for_stock,
  org_id
)
SELECT
  uol.supplier_order_id,
  NULL,
  uol.component_id,
  0,
  uol.order_quantity - uol.allocation_total,
  uol.org_id
FROM underallocated_open_lines uol
LEFT JOIN updated_stock_rows usr
  ON usr.supplier_order_id = uol.supplier_order_id
WHERE usr.supplier_order_id IS NULL
  AND (uol.order_quantity - uol.allocation_total) > 0;
