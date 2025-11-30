-- Fix status naming in purchasing RPC functions
-- This migration updates the process_supplier_order_receipt and process_supplier_order_return
-- functions to use the correct status names: 'Fully Received' and 'Partially Received'
-- instead of the legacy 'Completed' and 'Partially Delivered' names.

drop function if exists public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text);
drop function if exists public.process_supplier_order_receipt(integer, integer, timestamptz);

-- ============================================================================
-- 1. Update process_supplier_order_receipt function
-- ============================================================================

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

  -- FIXED: Use 'fully received' instead of 'completed'
  select status_id
  into v_completed_status_id
  from supplier_order_statuses
  where lower(status_name) = 'fully received'
  limit 1;

  -- FIXED: Use 'partially received' instead of 'partially delivered'
  select status_id
  into v_partial_status_id
  from supplier_order_statuses
  where lower(status_name) = 'partially received'
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

-- ============================================================================
-- 2. Update process_supplier_order_return function
-- ============================================================================

create or replace function public.process_supplier_order_return(
  p_supplier_order_id integer,
  p_quantity numeric,
  p_reason text,
  p_return_type text default 'later_return',
  p_return_date timestamptz default timezone('utc', now()),
  p_receipt_id bigint default null,
  p_notes text default null
)
returns table (
  return_id integer,
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
  v_return_type_id integer;
  v_transaction_id integer;
  v_return supplier_order_returns%rowtype;
  v_quantity_on_hand integer;
  v_total_received integer;
  v_new_status_id integer;
  v_completed_status_id integer;
  v_partial_status_id integer;
  v_return_timestamp timestamptz := coalesce(p_return_date, timezone('utc', now()));
  v_current_user_id uuid;
begin
  -- Get current user
  v_current_user_id := auth.uid();

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
    so.status_id
  into v_order
  from supplier_orders so
  where so.order_id = p_supplier_order_id
  for update;

  if not found then
    raise exception 'process_supplier_order_return: supplier order % not found', p_supplier_order_id;
  end if;

  if v_order.supplier_component_id is null then
    raise exception 'process_supplier_order_return: supplier order % is missing supplier component id', p_supplier_order_id;
  end if;

  -- Get component ID
  select sc.component_id
  into v_component_id
  from suppliercomponents sc
  where sc.supplier_component_id = v_order.supplier_component_id;

  if v_component_id is null then
    raise exception 'process_supplier_order_return: component for supplier component % not found', v_order.supplier_component_id;
  end if;

  -- Validate that we have enough received quantity to return
  if p_quantity > v_order.total_received then
    raise exception 'process_supplier_order_return: quantity % exceeds total received % for order %',
      p_quantity,
      v_order.total_received,
      p_supplier_order_id;
  end if;

  -- Get or create the OUT transaction type
  insert into transaction_types (type_name)
  values ('OUT')
  on conflict (type_name) do update set type_name = excluded.type_name
  returning transaction_type_id into v_return_type_id;

  if v_return_type_id is null then
    select transaction_type_id
    into v_return_type_id
    from transaction_types
    where type_name = 'OUT';
  end if;

  -- Create inventory transaction (negative quantity for returns)
  insert into inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date
  )
  values (
    v_component_id,
    -p_quantity,
    v_return_type_id,
    v_return_timestamp
  )
  returning transaction_id
  into v_transaction_id;

  -- Create supplier order return record
  insert into supplier_order_returns (
    supplier_order_id,
    transaction_id,
    quantity_returned,
    return_date,
    return_type,
    reason,
    receipt_id,
    notes,
    created_by
  )
  values (
    p_supplier_order_id,
    v_transaction_id,
    p_quantity,
    v_return_timestamp,
    p_return_type,
    trim(p_reason),
    p_receipt_id,
    p_notes,
    v_current_user_id
  )
  returning *
  into v_return;

  -- Update inventory (decrease quantity on hand)
  update inventory
  set quantity_on_hand = greatest(coalesce(quantity_on_hand, 0) - p_quantity, 0)
  where component_id = v_component_id
  returning quantity_on_hand
  into v_quantity_on_hand;

  if not found then
    raise exception 'process_supplier_order_return: inventory record not found for component %', v_component_id;
  end if;

  -- Recalculate total_received (receipts minus returns)
  with receipt_total as (
    select coalesce(sum(quantity_received), 0) as total
    from supplier_order_receipts
    where order_id = p_supplier_order_id
  ),
  return_total as (
    select coalesce(sum(quantity_returned), 0) as total
    from supplier_order_returns
    where supplier_order_id = p_supplier_order_id
  )
  select
    coalesce((select total from receipt_total), 0) - coalesce((select total from return_total), 0)
  into v_total_received;

  -- FIXED: Use 'fully received' instead of 'completed'
  select status_id
  into v_completed_status_id
  from supplier_order_statuses
  where lower(status_name) = 'fully received'
  limit 1;

  -- FIXED: Use 'partially received' instead of 'partially delivered'
  select status_id
  into v_partial_status_id
  from supplier_order_statuses
  where lower(status_name) = 'partially received'
  limit 1;

  -- Determine new status based on total_received
  v_new_status_id := v_order.status_id;

  if v_total_received >= v_order.order_quantity and v_completed_status_id is not null then
    v_new_status_id := v_completed_status_id;
  elsif v_total_received > 0 and v_partial_status_id is not null then
    v_new_status_id := v_partial_status_id;
  elsif v_total_received = 0 then
    -- If all goods returned, might want to revert to a different status
    -- For now, keep current status or set to partial if we had some received
    -- This is a business decision - you may want to adjust this logic
    null; -- Keep current status
  end if;

  -- Update supplier order with new total_received and status
  update supplier_orders
  set total_received = v_total_received,
      status_id = v_new_status_id
  where order_id = p_supplier_order_id;

  -- Return results
  return query
  select
    v_return.return_id,
    v_transaction_id,
    v_total_received,
    v_new_status_id,
    v_quantity_on_hand;
end;
$$;

comment on function public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text)
  is 'Processes supplier order return: creates OUT inventory transaction, return record, decrements inventory, and recomputes totals/status atomically.';

grant execute on function public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text)
  to authenticated, service_role;
