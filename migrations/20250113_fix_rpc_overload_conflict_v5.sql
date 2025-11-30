-- Fix function overloading conflict for process_supplier_order_return (Version 5)
-- Fixes ambiguous column reference by being explicit about table names

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text);
DROP FUNCTION IF EXISTS public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text, text, bigint, text);

-- Recreate the function with explicit table references
CREATE OR REPLACE FUNCTION public.process_supplier_order_return(
  p_supplier_order_id integer,
  p_quantity numeric,
  p_reason text,
  p_return_type text DEFAULT 'later_return',
  p_return_date timestamptz DEFAULT timezone('utc', now()),
  p_receipt_id bigint DEFAULT null,
  p_notes text DEFAULT null,
  p_goods_return_number text DEFAULT null,
  p_batch_id bigint DEFAULT null,
  p_signature_status text DEFAULT 'none'
)
RETURNS TABLE (
  return_id bigint,
  transaction_id integer,
  total_received numeric,
  order_status_id integer,
  quantity_on_hand numeric,
  goods_return_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
BEGIN
  -- Get the current user
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

  -- Get component ID from suppliercomponents table
  select sc.component_id
  into v_component_id
  from suppliercomponents sc
  where sc.supplier_component_id = v_order.supplier_component_id;

  if v_component_id is null then
    raise exception 'process_supplier_order_return: component for supplier component % not found', v_order.supplier_component_id;
  end if;

  v_purchase_order_id := v_order.purchase_order_id;

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
  on conflict (type_name) do nothing;

  select transaction_type_id into v_sale_type_id
  from transaction_types
  where type_name = 'SALE'
  limit 1;

  if v_sale_type_id is null then
    raise exception 'process_supplier_order_return: SALE transaction type not found';
  end if;

  -- Create OUT inventory transaction (negative quantity)
  -- EXPLICIT: Use table prefix to avoid ambiguity
  insert into inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date
  )
  values (
    v_component_id,
    -p_quantity,  -- Negative quantity for OUT transaction
    v_sale_type_id,
    v_return_timestamp
  )
  returning inventory_transactions.transaction_id
  into v_transaction_id;

  -- Create return record with all fields
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
    coalesce(p_signature_status, 'none')
  )
  returning * into v_return;

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
        and return_type = 'later_return'
    )
    update supplier_orders
    set total_received = greatest((select total from receipt_total) - (select total from return_total), 0)
    where order_id = p_supplier_order_id
    returning total_received into v_total_received;
  elsif p_return_type = 'rejection' then
    -- Rejection: just decrement total_received (rejected at gate before entering stock)
    update supplier_orders
    set total_received = greatest(coalesce(total_received, 0) - p_quantity, 0)
    where order_id = p_supplier_order_id
    returning total_received into v_total_received;
  end if;

  -- Get status IDs for comparison
  select status_id into v_completed_status_id
  from supplier_order_statuses
  where lower(status_name) = 'fully received'
  limit 1;

  select status_id into v_partial_status_id
  from supplier_order_statuses
  where lower(status_name) = 'partially received'
  limit 1;

  -- Update supplier_orders status based on new total_received
  if v_total_received >= v_order.order_quantity then
    v_new_status_id := v_completed_status_id;
  elsif v_total_received > 0 then
    v_new_status_id := v_partial_status_id;
  else
    -- If total_received is now 0, keep current status
    v_new_status_id := null;
  end if;

  if v_new_status_id is not null then
    update supplier_orders
    set status_id = v_new_status_id
    where order_id = p_supplier_order_id;
  end if;

  -- Return results
  return query
  select
    v_return.return_id,
    v_transaction_id,
    v_total_received,
    v_new_status_id,
    v_quantity_on_hand,
    v_grn;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text, text, bigint, text) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION public.process_supplier_order_return IS 'Process a supplier order return with conditional inventory logic. Uses explicit table prefixes to avoid ambiguous column references.';
