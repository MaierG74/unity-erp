-- Enhance supplier_order_returns table for document generation, email tracking, and signature collection
-- This migration adds support for GRN (Goods Return Number), PDF documentation, email status, and batch returns

-- Add new columns to supplier_order_returns
alter table public.supplier_order_returns
  add column if not exists document_url text,
  add column if not exists signed_document_url text,
  add column if not exists document_version smallint default 1,
  add column if not exists email_status text check (email_status in ('sent', 'skipped', 'failed')),
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_message_id text,
  add column if not exists goods_return_number text,
  add column if not exists batch_id bigint,
  add column if not exists signature_status text check (signature_status in ('none', 'operator', 'driver')) default 'none';

-- Ensure legacy unique constraint is removed to allow batch returns sharing GRNs
alter table public.supplier_order_returns
  drop constraint if exists supplier_order_returns_goods_return_number_key;

-- Add comments for new columns
comment on column public.supplier_order_returns.document_url is 'URL to unsigned PDF document in supplier-returns storage bucket';
comment on column public.supplier_order_returns.signed_document_url is 'URL to signed PDF document uploaded after driver/operator signature';
comment on column public.supplier_order_returns.document_version is 'Version number for document tracking';
comment on column public.supplier_order_returns.email_status is 'Status of email notification: sent, skipped (operator choice), or failed';
comment on column public.supplier_order_returns.email_sent_at is 'Timestamp when email notification was sent to supplier';
comment on column public.supplier_order_returns.email_message_id is 'Email provider message ID for tracking';
comment on column public.supplier_order_returns.goods_return_number is 'Unique GRN formatted as GRN-YY-#### for tracking and credit reconciliation';
comment on column public.supplier_order_returns.batch_id is 'Groups multiple component returns under single GRN (one PDF per batch)';
comment on column public.supplier_order_returns.signature_status is 'Tracks signature collection: none (no signature), operator (operator signed), driver (driver signed)';

-- Create indexes for new columns
create index if not exists idx_supplier_order_returns_goods_return_number on public.supplier_order_returns(goods_return_number);
create index if not exists idx_supplier_order_returns_batch_id on public.supplier_order_returns(batch_id);
create index if not exists idx_supplier_order_returns_email_status on public.supplier_order_returns(email_status);

-- Create sequence for GRN generation
create sequence if not exists public.goods_return_number_seq start with 1;

-- Grant usage on sequence
grant usage, select on sequence public.goods_return_number_seq to authenticated, service_role;

-- Create helper function to generate Goods Return Number (GRN)
-- Format: GRN-YY-#### where YY is last 2 digits of year and #### is zero-padded sequence
create or replace function public.generate_goods_return_number(
  p_purchase_order_id bigint default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_suffix text;
  v_sequence_num bigint;
  v_grn text;
begin
  -- Get last 2 digits of current year
  v_year_suffix := to_char(now(), 'YY');

  -- Get next sequence number (atomic)
  v_sequence_num := nextval('goods_return_number_seq');

  -- Format: GRN-25-0004
  v_grn := 'GRN-' || v_year_suffix || '-' || lpad(v_sequence_num::text, 4, '0');

  return v_grn;
end;
$$;

comment on function public.generate_goods_return_number(bigint)
  is 'Generates unique Goods Return Number in format GRN-YY-#### with atomic sequence';

grant execute on function public.generate_goods_return_number(bigint) to authenticated, service_role;

-- Modify process_supplier_order_return RPC to add conditional inventory logic
-- Key change: rejections skip inventory decrement (goods never entered stock)
--             later_returns decrement inventory (taking goods out of stock)
create or replace function public.process_supplier_order_return(
  p_supplier_order_id integer,
  p_quantity numeric,
  p_reason text,
  p_return_type text default 'later_return',
  p_return_date timestamptz default timezone('utc', now()),
  p_receipt_id bigint default null,
  p_notes text default null,
  p_goods_return_number text default null,
  p_batch_id bigint default null,
  p_signature_status text default 'none'
)
returns table (
  return_id bigint,
  transaction_id integer,
  total_received numeric,
  order_status_id integer,
  quantity_on_hand numeric,
  goods_return_number text
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
  v_grn text;
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

  if p_signature_status not in ('none', 'operator', 'driver') then
    raise exception 'process_supplier_order_return: signature_status must be ''none'', ''operator'', or ''driver''';
  end if;

  -- Use provided GRN or generate new one
  v_grn := coalesce(p_goods_return_number, generate_goods_return_number(null));

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

  -- Validate quantity based on return type
  if p_return_type = 'later_return' then
    -- For later returns, validate against total_received (must have received goods first)
    if p_quantity > v_order.total_received then
      raise exception 'process_supplier_order_return: quantity % exceeds total received % for order %',
        p_quantity,
        v_order.total_received,
        p_supplier_order_id;
    end if;
  elsif p_return_type = 'rejection' then
    -- For rejections at gate, validate against order_quantity (can't reject more than ordered)
    if p_quantity > v_order.order_quantity then
      raise exception 'process_supplier_order_return: rejection quantity % exceeds order quantity % for order %',
        p_quantity,
        v_order.order_quantity,
        p_supplier_order_id;
    end if;
  end if;

  -- Get or create SALE transaction type (for OUT transactions)
  insert into transaction_types (type_name)
  values ('SALE')
  on conflict (type_name) do update set type_name = excluded.type_name
  returning transaction_types.transaction_type_id into v_sale_type_id;

  if v_sale_type_id is null then
    select transaction_type_id
    into v_sale_type_id
    from transaction_types
    where type_name = 'SALE';
  end if;

  -- Get purchase_order_id from supplier order
  v_purchase_order_id := v_order.purchase_order_id;

  -- Create OUT inventory transaction (negative quantity)
  -- NOTE: Transaction is always created for audit trail, regardless of return_type
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
  returning inventory_transactions.transaction_id
  into v_transaction_id;

  -- Create return record with new fields
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
    goods_return_number,
    batch_id,
    signature_status
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
    p_notes,
    v_grn,
    p_batch_id,
    p_signature_status
  )
  returning *
  into v_return;

  -- CRITICAL: Conditional inventory decrement based on return_type
  if p_return_type = 'later_return' then
    -- Later return: goods were in stock, decrement inventory
    update inventory
    set quantity_on_hand = greatest(coalesce(inventory.quantity_on_hand, 0) - p_quantity, 0)
    where component_id = v_component_id
    returning inventory.quantity_on_hand
    into v_quantity_on_hand;

    if not found then
      -- Component doesn't exist in inventory yet, set to 0
      v_quantity_on_hand := 0;
    end if;
  elsif p_return_type = 'rejection' then
    -- Rejection at gate: goods never entered stock, DO NOT decrement inventory
    -- Just get current quantity_on_hand for reporting
    select coalesce(inventory.quantity_on_hand, 0)
    into v_quantity_on_hand
    from inventory
    where component_id = v_component_id;

    if not found then
      v_quantity_on_hand := 0;
    end if;
  end if;

  -- Recompute total_received differently based on return_type
  if p_return_type = 'later_return' then
    -- Later return: subtract from receipts (net received = receipts - returns)
    with receipt_total as (
      select coalesce(sum(quantity_received), 0) as total
      from supplier_order_receipts
      where order_id = p_supplier_order_id
    ),
    return_total as (
      select coalesce(sum(quantity_returned), 0) as total
      from supplier_order_returns
      where supplier_order_id = p_supplier_order_id
        and return_type = 'later_return'  -- Only count later returns
    )
    select
      coalesce((select total from receipt_total), 0) - coalesce((select total from return_total), 0)
    into v_total_received;
  elsif p_return_type = 'rejection' then
    -- Rejection: total_received stays same (rejections don't affect net received)
    -- We track rejections separately for audit, but they don't reduce total_received
    select coalesce(sum(quantity_received), 0)
    into v_total_received
    from supplier_order_receipts
    where order_id = p_supplier_order_id;

    -- Subtract any later_returns (but NOT rejections)
    select coalesce(v_total_received, 0) - coalesce(sum(quantity_returned), 0)
    into v_total_received
    from supplier_order_returns
    where supplier_order_id = p_supplier_order_id
      and return_type = 'later_return';
  end if;

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
    -- If all goods returned, keep current status
    null;
  end if;

  -- Update supplier order with new total_received and status
  update supplier_orders
  set total_received = v_total_received,
      status_id = v_new_status_id
  where order_id = p_supplier_order_id;

  -- Return results including GRN
  return query
  select
    v_return.return_id,
    v_transaction_id,
    v_total_received,
    v_new_status_id,
    v_quantity_on_hand,
    v_grn;
end;
$$;

comment on function public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text, text, bigint, text)
  is 'Processes supplier order return with conditional inventory logic: rejections (at gate) skip inventory decrement, later_returns (from stock) decrement inventory. Creates transaction, return record, generates GRN, and updates totals/status atomically.';

grant execute on function public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text, text, bigint, text)
  to authenticated, service_role;
