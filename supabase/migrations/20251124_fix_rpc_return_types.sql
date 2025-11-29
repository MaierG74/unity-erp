
-- Update process_supplier_order_receipt to fix return types (integer -> bigint)
create or replace function public.process_supplier_order_receipt(
  p_order_id integer,
  p_quantity integer,
  p_receipt_date timestamptz default timezone('utc', now())
)
returns table (
  receipt_id bigint,
  transaction_id bigint,
  total_received integer,
  order_status_id integer,
  quantity_on_hand integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_comp_id integer;
  v_purch_type_id integer;
  v_txn_id bigint;
  v_new_receipt supplier_order_receipts%rowtype;
  v_qty_on_hand integer;
  v_tot_received integer;
  v_new_stat_id integer;
  v_comp_stat_id integer;
  v_part_stat_id integer;
  v_receipt_ts timestamptz := coalesce(p_receipt_date, timezone('utc', now()));
begin
  if p_order_id is null then
    raise exception 'process_supplier_order_receipt: order id is required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'process_supplier_order_receipt: quantity must be greater than zero';
  end if;

  select
    so.order_id,
    so.supplier_component_id,
    coalesce(so.order_quantity, 0) as order_quantity,
    coalesce(so.total_received, 0) as total_received,
    so.status_id
  into v_order
  from supplier_orders so
  where so.order_id = p_order_id
  for update;

  if not found then
    raise exception 'process_supplier_order_receipt: supplier order % not found', p_order_id;
  end if;

  if v_order.supplier_component_id is null then
    raise exception 'process_supplier_order_receipt: supplier order % is missing supplier component id', p_order_id;
  end if;

  select sc.component_id
  into v_comp_id
  from suppliercomponents sc
  where sc.supplier_component_id = v_order.supplier_component_id;

  if v_comp_id is null then
    raise exception 'process_supplier_order_receipt: component for supplier component % not found', v_order.supplier_component_id;
  end if;

  insert into transaction_types (type_name)
  values ('PURCHASE')
  on conflict (type_name) do update set type_name = excluded.type_name
  returning transaction_types.transaction_type_id into v_purch_type_id;

  if v_purch_type_id is null then
    select transaction_types.transaction_type_id
    into v_purch_type_id
    from transaction_types
    where transaction_types.type_name = 'PURCHASE';
  end if;

  insert into inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date
  )
  values (
    v_comp_id,
    p_quantity,
    v_purch_type_id,
    v_receipt_ts
  )
  returning inventory_transactions.transaction_id
  into v_txn_id;

  insert into supplier_order_receipts (
    order_id,
    transaction_id,
    quantity_received,
    receipt_date
  )
  values (
    p_order_id,
    v_txn_id,
    p_quantity,
    v_receipt_ts
  )
  returning *
  into v_new_receipt;

  update inventory
  set quantity_on_hand = coalesce(inventory.quantity_on_hand, 0) + p_quantity
  where inventory.component_id = v_comp_id
  returning inventory.quantity_on_hand
  into v_qty_on_hand;

  if not found then
    insert into inventory (
      component_id,
      quantity_on_hand,
      location,
      reorder_level
    )
    values (
      v_comp_id,
      p_quantity,
      null,
      0
    )
    returning inventory.quantity_on_hand
    into v_qty_on_hand;
  end if;

  -- Recompute total_received (subtract returned quantity)
  with receipt_total as (
    select coalesce(sum(supplier_order_receipts.quantity_received), 0) as total
    from supplier_order_receipts
    where supplier_order_receipts.order_id = p_order_id
  ),
  return_total as (
    select coalesce(sum(supplier_order_returns.quantity_returned), 0) as total
    from supplier_order_returns
    where supplier_order_returns.supplier_order_id = p_order_id
  )
  select 
    coalesce((select total from receipt_total), 0) - coalesce((select total from return_total), 0)
  into v_tot_received;

  select supplier_order_statuses.status_id
  into v_comp_stat_id
  from supplier_order_statuses
  where lower(supplier_order_statuses.status_name) = 'fully received'
  limit 1;

  select supplier_order_statuses.status_id
  into v_part_stat_id
  from supplier_order_statuses
  where lower(supplier_order_statuses.status_name) = 'partially received'
  limit 1;

  v_new_stat_id := v_order.status_id;

  if v_tot_received >= v_order.order_quantity and v_comp_stat_id is not null then
    v_new_stat_id := v_comp_stat_id;
  elsif v_tot_received > 0 and v_part_stat_id is not null then
    v_new_stat_id := v_part_stat_id;
  end if;

  update supplier_orders
  set total_received = v_tot_received,
      status_id = v_new_stat_id
  where supplier_orders.order_id = p_order_id;

  return query
  select
    v_new_receipt.receipt_id,
    v_txn_id,
    v_tot_received,
    v_new_stat_id,
    v_qty_on_hand;
end;
$$;
