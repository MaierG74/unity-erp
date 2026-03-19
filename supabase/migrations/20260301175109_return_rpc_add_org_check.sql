-- Add org membership check to process_supplier_order_return (security fix).
-- The receipt RPC already had this check; the return RPC was missing it.

CREATE OR REPLACE FUNCTION public.process_supplier_order_return(
  p_supplier_order_id integer,
  p_quantity numeric,
  p_reason text,
  p_return_type text DEFAULT 'later_return'::text,
  p_return_date timestamp with time zone DEFAULT timezone('utc'::text, now()),
  p_receipt_id bigint DEFAULT NULL::bigint,
  p_notes text DEFAULT NULL::text
)
RETURNS TABLE(
  return_id bigint,
  transaction_id bigint,
  total_received numeric,
  order_status_id integer,
  quantity_on_hand numeric,
  goods_return_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_comp_id integer;
  v_purch_order_id bigint;
  v_return_type_id integer;
  v_txn_id bigint;
  v_new_return supplier_order_returns%rowtype;
  v_qty_on_hand numeric;
  v_tot_received numeric;
  v_new_stat_id integer;
  v_comp_stat_id integer;
  v_part_stat_id integer;
  v_curr_user_id uuid;
  v_ret_ts timestamptz := coalesce(p_return_date, timezone('utc', now()));
  v_grn text;
begin
  -- Get current user
  v_curr_user_id := auth.uid();

  if p_supplier_order_id is null then
    raise exception 'process_supplier_order_return: supplier order id is required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'process_supplier_order_return: quantity must be greater than zero';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'process_supplier_order_return: reason is required';
  end if;

  if p_return_type not in ('rejection', 'later_return') then
    raise exception 'process_supplier_order_return: return_type must be ''rejection'' or ''later_return''';
  end if;

  -- Lock supplier order row for update
  select
    so.order_id,
    so.supplier_component_id,
    coalesce(so.order_quantity, 0) as order_quantity,
    coalesce(so.total_received, 0) as total_received,
    so.status_id,
    so.purchase_order_id,
    so.org_id
  into v_order
  from supplier_orders so
  where so.order_id = p_supplier_order_id
  for update;

  if not found then
    raise exception 'process_supplier_order_return: supplier order % not found', p_supplier_order_id;
  end if;

  -- Org membership check (security fix: was missing before)
  IF v_order.org_id IS NOT NULL AND auth.role() <> 'service_role' AND NOT is_org_member(v_order.org_id) THEN
    RAISE EXCEPTION 'process_supplier_order_return: access denied';
  END IF;

  if v_order.supplier_component_id is null then
    raise exception 'process_supplier_order_return: supplier order % is missing supplier component id', p_supplier_order_id;
  end if;

  -- Get component ID
  select sc.component_id
  into v_comp_id
  from suppliercomponents sc
  where sc.supplier_component_id = v_order.supplier_component_id;

  if v_comp_id is null then
    raise exception 'process_supplier_order_return: component for supplier component % not found', v_order.supplier_component_id;
  end if;

  -- Get or create RETURN transaction type (for supplier returns)
  insert into transaction_types (type_name)
  values ('RETURN')
  on conflict (type_name) do update set type_name = excluded.type_name
  returning transaction_types.transaction_type_id into v_return_type_id;

  if v_return_type_id is null then
    select transaction_types.transaction_type_id
    into v_return_type_id
    from transaction_types
    where transaction_types.type_name = 'RETURN';
  end if;

  -- Get purchase_order_id from supplier order
  v_purch_order_id := v_order.purchase_order_id;

  -- Generate GRN number (format: GRN-YY-NNNN)
  SELECT 'GRN-' || to_char(now(), 'YY') || '-' ||
         lpad((coalesce(max(
           CASE
             WHEN sor.goods_return_number ~ '^GRN-[0-9]{2}-[0-9]+$'
             THEN substring(sor.goods_return_number from 8)::integer
             ELSE 0
           END
         ), 0) + 1)::text, 4, '0')
  INTO v_grn
  FROM supplier_order_returns sor
  WHERE sor.goods_return_number LIKE 'GRN-' || to_char(now(), 'YY') || '-%';

  -- Create RETURN inventory transaction (negative quantity)
  insert into inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date,
    supplier_order_id,
    purchase_order_id,
    user_id,
    reason
  )
  values (
    v_comp_id,
    -p_quantity,
    v_return_type_id,
    v_ret_ts,
    p_supplier_order_id,
    v_purch_order_id,
    v_curr_user_id,
    p_reason
  )
  returning inventory_transactions.transaction_id
  into v_txn_id;

  -- Create return record with GRN
  insert into supplier_order_returns (
    supplier_order_id,
    transaction_id,
    quantity_returned,
    return_date,
    reason,
    return_type,
    receipt_id,
    user_id,
    notes,
    goods_return_number
  )
  values (
    p_supplier_order_id,
    v_txn_id,
    p_quantity,
    v_ret_ts,
    p_reason,
    p_return_type,
    p_receipt_id,
    v_curr_user_id,
    p_notes,
    v_grn
  )
  returning *
  into v_new_return;

  -- Decrement inventory quantity_on_hand
  update inventory
  set quantity_on_hand = greatest(coalesce(inventory.quantity_on_hand, 0) - p_quantity, 0)
  where inventory.component_id = v_comp_id
  returning inventory.quantity_on_hand
  into v_qty_on_hand;

  if not found then
    v_qty_on_hand := 0;
  end if;

  -- Recompute total_received (subtract returned quantity)
  with receipt_total as (
    select coalesce(sum(r.quantity_received), 0) as total
    from supplier_order_receipts r
    where r.order_id = p_supplier_order_id
  ),
  return_total as (
    select coalesce(sum(rt.quantity_returned), 0) as total
    from supplier_order_returns rt
    where rt.supplier_order_id = p_supplier_order_id
  )
  select
    coalesce((select total from receipt_total), 0) - coalesce((select total from return_total), 0)
  into v_tot_received;

  -- Get status IDs
  select s.status_id
  into v_comp_stat_id
  from supplier_order_statuses s
  where lower(s.status_name) = 'fully received'
  limit 1;

  select s.status_id
  into v_part_stat_id
  from supplier_order_statuses s
  where lower(s.status_name) = 'partially received'
  limit 1;

  -- Determine new status based on total_received
  v_new_stat_id := v_order.status_id;

  if v_tot_received >= v_order.order_quantity and v_comp_stat_id is not null then
    v_new_stat_id := v_comp_stat_id;
  elsif v_tot_received > 0 and v_part_stat_id is not null then
    v_new_stat_id := v_part_stat_id;
  elsif v_tot_received = 0 then
    null;
  end if;

  -- Update supplier order with new total_received and status
  update supplier_orders
  set total_received = v_tot_received,
      status_id = v_new_stat_id
  where supplier_orders.order_id = p_supplier_order_id;

  -- Return results including goods_return_number
  return query
  select
    v_new_return.return_id,
    v_txn_id,
    v_tot_received,
    v_new_stat_id,
    v_qty_on_hand,
    v_new_return.goods_return_number;
end;
$function$;
