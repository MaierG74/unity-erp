-- Create a transactional RPC to process supplier order receipts
-- Inserts inventory transaction, receipt record, updates inventory, and recomputes totals/status

create or replace function public.process_supplier_order_receipt(
  p_order_id integer,
  p_quantity integer,
  p_receipt_date timestamptz default timezone('utc', now())
)
returns table (
  receipt_id integer,
  transaction_id integer,
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
  v_component_id integer;
  v_purchase_type_id integer;
  v_transaction_id integer;
  v_receipt supplier_order_receipts%rowtype;
  v_quantity_on_hand integer;
  v_total_received integer;
  v_new_status_id integer;
  v_completed_status_id integer;
  v_partial_status_id integer;
  v_receipt_timestamp timestamptz := coalesce(p_receipt_date, timezone('utc', now()));
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
  into v_component_id
  from suppliercomponents sc
  where sc.supplier_component_id = v_order.supplier_component_id;

  if v_component_id is null then
    raise exception 'process_supplier_order_receipt: component for supplier component % not found', v_order.supplier_component_id;
  end if;

  if p_quantity > greatest(v_order.order_quantity - v_order.total_received, 0) then
    raise exception 'process_supplier_order_receipt: quantity % exceeds remaining % for order %',
      p_quantity,
      greatest(v_order.order_quantity - v_order.total_received, 0),
      p_order_id;
  end if;

  insert into transaction_types (type_name)
  values ('PURCHASE')
  on conflict (type_name) do update set type_name = excluded.type_name
  returning transaction_type_id into v_purchase_type_id;

  if v_purchase_type_id is null then
    select transaction_type_id
    into v_purchase_type_id
    from transaction_types
    where type_name = 'PURCHASE';
  end if;

  insert into inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date
  )
  values (
    v_component_id,
    p_quantity,
    v_purchase_type_id,
    v_receipt_timestamp
  )
  returning transaction_id
  into v_transaction_id;

  insert into supplier_order_receipts (
    order_id,
    transaction_id,
    quantity_received,
    receipt_date
  )
  values (
    p_order_id,
    v_transaction_id,
    p_quantity,
    v_receipt_timestamp
  )
  returning *
  into v_receipt;

  update inventory
  set quantity_on_hand = coalesce(quantity_on_hand, 0) + p_quantity
  where component_id = v_component_id
  returning quantity_on_hand
  into v_quantity_on_hand;

  if not found then
    insert into inventory (
      component_id,
      quantity_on_hand,
      location,
      reorder_level
    )
    values (
      v_component_id,
      p_quantity,
      null,
      0
    )
    returning quantity_on_hand
    into v_quantity_on_hand;
  end if;

  select coalesce(sum(quantity_received), 0)
  into v_total_received
  from supplier_order_receipts
  where order_id = p_order_id;

  select status_id
  into v_completed_status_id
  from supplier_order_statuses
  where lower(status_name) = 'completed'
  limit 1;

  select status_id
  into v_partial_status_id
  from supplier_order_statuses
  where lower(status_name) = 'partially delivered'
  limit 1;

  v_new_status_id := v_order.status_id;

  if v_total_received >= v_order.order_quantity and v_completed_status_id is not null then
    v_new_status_id := v_completed_status_id;
  elsif v_total_received > 0 and v_partial_status_id is not null then
    v_new_status_id := v_partial_status_id;
  end if;

  update supplier_orders
  set total_received = v_total_received,
      status_id = v_new_status_id
  where order_id = p_order_id;

  return query
  select
    v_receipt.receipt_id,
    v_transaction_id,
    v_total_received,
    v_new_status_id,
    v_quantity_on_hand;
end;
$$;

comment on function public.process_supplier_order_receipt(integer, integer, timestamptz)
  is 'Processes supplier order receipt: creates inventory transaction, receipt, updates inventory, and recomputes totals/status atomically.';

grant execute on function public.process_supplier_order_receipt(integer, integer, timestamptz)
  to authenticated, service_role;
