-- Fix function overloading conflict for process_supplier_order_return
-- Drop all versions of the function and recreate with the correct signature

-- Drop all existing versions of the function
DROP FUNCTION IF EXISTS public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text);
DROP FUNCTION IF EXISTS public.process_supplier_order_return(integer, numeric, text, text, timestamptz, bigint, text, text, bigint, text);

-- Recreate the function with the correct signature
-- This is the definitive version with all parameters
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
  if v_current_user_id is null then
    raise exception 'User not authenticated';
  end if;

  -- Get supplier order details with component_id and purchase_order_id
  select
    so.component_id,
    so.purchase_order_id,
    so.order_quantity,
    so.total_received
  into v_order
  from supplier_orders so
  where so.order_id = p_supplier_order_id;

  if not found then
    raise exception 'Supplier order % not found', p_supplier_order_id;
  end if;

  v_component_id := v_order.component_id;
  v_purchase_order_id := v_order.purchase_order_id;

  -- Get sale_type_id for Returns (should exist in sale_types table)
  select sale_type_id into v_sale_type_id
  from sale_types
  where sale_type_name = 'Returns'
  limit 1;

  if v_sale_type_id is null then
    raise exception 'Returns sale type not found. Please ensure sale_types table has a "Returns" entry.';
  end if;

  -- Generate GRN if not provided
  if p_goods_return_number is null then
    v_grn := generate_goods_return_number(v_purchase_order_id);
  else
    v_grn := p_goods_return_number;
  end if;

  -- Insert supplier order return record
  insert into supplier_order_returns (
    supplier_order_id,
    quantity_returned,
    return_date,
    reason,
    return_type,
    receipt_id,
    notes,
    goods_return_number,
    batch_id,
    signature_status
  ) values (
    p_supplier_order_id,
    p_quantity,
    v_return_timestamp,
    p_reason,
    p_return_type,
    p_receipt_id,
    p_notes,
    v_grn,
    p_batch_id,
    coalesce(p_signature_status, 'none')
  )
  returning * into v_return;

  -- CRITICAL: Only decrement inventory for later_return type
  -- Rejections (rejected at gate) should NOT decrement inventory because goods never entered stock
  if p_return_type = 'later_return' then
    -- Create component transaction (negative quantity = removing from inventory)
    insert into component_transactions (
      component_id,
      sale_type_id,
      quantity,
      transaction_date,
      notes,
      supplier_order_id
    ) values (
      v_component_id,
      v_sale_type_id,
      -p_quantity,  -- Negative because we're returning/removing from stock
      v_return_timestamp,
      coalesce(p_notes, 'Return: ' || p_reason),
      p_supplier_order_id
    )
    returning transaction_id into v_transaction_id;

    -- Update component inventory (decrement quantity_in_stock)
    update component_inventory
    set quantity_in_stock = quantity_in_stock - p_quantity
    where component_id = v_component_id;

    -- Get updated quantity on hand
    select quantity_in_stock into v_quantity_on_hand
    from component_inventory
    where component_id = v_component_id;
  else
    -- For rejections, set transaction_id to null and don't touch inventory
    v_transaction_id := null;

    -- Get current quantity on hand without changing it
    select quantity_in_stock into v_quantity_on_hand
    from component_inventory
    where component_id = v_component_id;
  end if;

  -- Update total_received on supplier_orders
  -- CRITICAL: For later_return, decrement total_received (goods are leaving)
  --           For rejection, decrement total_received (goods were never accepted)
  -- Both cases reduce total_received, but only later_return affects inventory
  update supplier_orders
  set total_received = greatest(0, total_received - p_quantity)
  where order_id = p_supplier_order_id
  returning total_received into v_total_received;

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
    -- If total_received is now 0, keep current status or set to a default
    -- (Don't change status if everything was returned)
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
COMMENT ON FUNCTION public.process_supplier_order_return IS 'Process a supplier order return with conditional inventory logic: rejections skip inventory decrement, later_returns decrement inventory';
