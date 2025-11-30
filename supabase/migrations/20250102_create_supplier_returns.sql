-- Create supplier_order_returns table and RPC function for processing returns
-- This allows returning goods to suppliers for Purchase Orders

-- Create supplier_order_returns table
create table if not exists public.supplier_order_returns (
  return_id bigint generated always as identity not null,
  supplier_order_id integer not null,
  transaction_id integer not null,
  quantity_returned numeric not null,
  return_date timestamptz not null default timezone('utc', now()),
  reason text not null,
  return_type text not null check (return_type in ('rejection', 'later_return')),
  receipt_id bigint null,
  user_id uuid null,
  notes text null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint supplier_order_returns_pkey primary key (return_id),
  constraint fk_supplier_order foreign key (supplier_order_id) references public.supplier_orders(order_id) on update cascade on delete restrict,
  constraint fk_inventory_transaction foreign key (transaction_id) references public.inventory_transactions(transaction_id) on update cascade on delete restrict,
  constraint fk_receipt foreign key (receipt_id) references public.supplier_order_receipts(receipt_id) on update cascade on delete set null,
  constraint fk_user foreign key (user_id) references auth.users(id) on update cascade on delete set null
);

comment on table public.supplier_order_returns is 'Records of goods returned to suppliers, linking returns to supplier orders and inventory transactions';
comment on column public.supplier_order_returns.return_type is 'Type of return: rejection (immediate rejection on delivery) or later_return (returning previously accepted goods)';
comment on column public.supplier_order_returns.reason is 'Required reason for the return (e.g., Damage, Wrong Item, Quality Issue)';

-- Create index for faster lookups
create index if not exists idx_supplier_order_returns_supplier_order_id on public.supplier_order_returns(supplier_order_id);
create index if not exists idx_supplier_order_returns_transaction_id on public.supplier_order_returns(transaction_id);
create index if not exists idx_supplier_order_returns_return_date on public.supplier_order_returns(return_date);

-- Enable RLS
alter table public.supplier_order_returns enable row level security;

-- Create RPC function to process supplier order returns
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
  return_id bigint,
  transaction_id integer,
  total_received numeric,
  order_status_id integer,
  quantity_on_hand numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_component_id integer;
  v_purchase_order_id bigint;
  v_sale_type_id integer;
  v_transaction_id integer;
  v_return supplier_order_returns%rowtype;
  v_quantity_on_hand numeric;
  v_total_received numeric;
  v_new_status_id integer;
  v_completed_status_id integer;
  v_partial_status_id integer;
  v_current_user_id uuid;
  v_return_timestamp timestamptz := coalesce(p_return_date, timezone('utc', now()));
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
    so.status_id,
    so.purchase_order_id
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

  -- Get or create SALE transaction type (for OUT transactions)
  insert into transaction_types (type_name)
  values ('SALE')
  on conflict (type_name) do update set type_name = excluded.type_name
  returning transaction_type_id into v_sale_type_id;

  if v_sale_type_id is null then
    select transaction_type_id
    into v_sale_type_id
    from transaction_types
    where type_name = 'SALE';
  end if;

  -- Get purchase_order_id from supplier order
  v_purchase_order_id := v_order.purchase_order_id;

  -- Create OUT inventory transaction (negative quantity)
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
    v_component_id,
    -p_quantity,  -- Negative quantity for OUT transaction
    v_sale_type_id,
    v_return_timestamp,
    p_supplier_order_id,
    v_purchase_order_id,
    v_current_user_id,
    p_reason
  )
  returning transaction_id
  into v_transaction_id;

  -- Create return record
  insert into supplier_order_returns (
    supplier_order_id,
    transaction_id,
    quantity_returned,
    return_date,
    reason,
    return_type,
    receipt_id,
    user_id,
    notes
  )
  values (
    p_supplier_order_id,
    v_transaction_id,
    p_quantity,
    v_return_timestamp,
    p_reason,
    p_return_type,
    p_receipt_id,
    v_current_user_id,
    p_notes
  )
  returning *
  into v_return;

  -- Decrement inventory quantity_on_hand
  update inventory
  set quantity_on_hand = greatest(coalesce(inventory.quantity_on_hand, 0) - p_quantity, 0)
  where component_id = v_component_id
  returning inventory.quantity_on_hand
  into v_quantity_on_hand;

  if not found then
    -- Component doesn't exist in inventory yet, set to 0 (shouldn't happen for returns, but handle gracefully)
    v_quantity_on_hand := 0;
  end if;

  -- Recompute total_received (subtract returned quantity)
  -- total_received should reflect net received (received - returned)
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

  -- Get status IDs
  select status_id
  into v_completed_status_id
  from supplier_order_statuses
  where lower(status_name) = 'fully received'
  limit 1;

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

-- Grant permissions on the table
grant select, insert, update on public.supplier_order_returns to authenticated;
grant select on public.supplier_order_returns to anon;

