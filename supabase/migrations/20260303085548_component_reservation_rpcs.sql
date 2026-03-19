-- Reserve components for an order: deletes existing reservations, then inserts
-- new ones based on current BOM requirements vs available stock (minus other orders' reservations).
CREATE OR REPLACE FUNCTION public.reserve_order_components(p_order_id INT, p_org_id UUID)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC)
LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM public.component_reservations cr
  WHERE cr.order_id = p_order_id AND cr.org_id = p_org_id;

  RETURN QUERY
  INSERT INTO public.component_reservations(order_id, component_id, qty_reserved, org_id)
  SELECT
    p_order_id,
    req.cid,
    GREATEST(0, LEAST(
      req.required_qty,
      COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
    )),
    p_org_id
  FROM (
    SELECT
      bom.component_id AS cid,
      SUM(bom.quantity_required * od.quantity)::NUMERIC AS required_qty
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE od.order_id = p_order_id
    GROUP BY bom.component_id
  ) req
  LEFT JOIN (
    SELECT i.component_id AS cid, COALESCE(i.quantity_on_hand, 0)::NUMERIC AS on_hand
    FROM public.inventory i
  ) inv ON inv.cid = req.cid
  LEFT JOIN (
    SELECT cr2.component_id AS cid, SUM(cr2.qty_reserved)::NUMERIC AS reserved
    FROM public.component_reservations cr2
    WHERE cr2.order_id <> p_order_id AND cr2.org_id = p_org_id
    GROUP BY cr2.component_id
  ) other_res ON other_res.cid = req.cid
  WHERE GREATEST(0, LEAST(
    req.required_qty,
    COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
  )) > 0
  RETURNING component_reservations.component_id, component_reservations.qty_reserved;
END;
$function$;

-- Release all component reservations for an order.
CREATE OR REPLACE FUNCTION public.release_order_components(p_order_id INT, p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER := 0;
BEGIN
  DELETE FROM public.component_reservations
  WHERE order_id = p_order_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
