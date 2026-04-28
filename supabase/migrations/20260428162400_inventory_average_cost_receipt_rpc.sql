-- POL-69 / Piece A: make supplier receipts write unit_cost and update WAC.
-- Signature intentionally matches the live nine-parameter RPC.

create or replace function public.process_supplier_order_receipt(
  p_order_id integer,
  p_quantity numeric,
  p_receipt_date timestamp with time zone default null::timestamp with time zone,
  p_notes text default null::text,
  p_allocation_receipts jsonb default null::jsonb,
  p_rejected_quantity numeric default 0,
  p_rejection_reason text default null::text,
  p_attachment_path text default null::text,
  p_attachment_name text default null::text
)
returns table(
  receipt_id bigint,
  transaction_id bigint,
  total_received numeric,
  new_status_id integer,
  quantity_on_hand numeric,
  return_id bigint,
  goods_return_number text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order record;
  v_comp_id integer;
  v_unit_cost numeric;
  v_purch_type_id integer;
  v_return_type_id integer;
  v_txn_id bigint;
  v_new_receipt supplier_order_receipts%rowtype;
  v_qty_on_hand numeric;
  v_tot_received numeric;
  v_net_received_before numeric;
  v_remaining numeric;
  v_new_stat_id integer;
  v_comp_stat_id integer;
  v_part_stat_id integer;
  v_receipt_ts timestamptz := coalesce(p_receipt_date, timezone('utc', now()));
  v_alloc_count integer := 0;
  v_payload_count integer := 0;
  v_payload_distinct_count integer := 0;
  v_payload_sum numeric := 0;
  v_good_quantity numeric;
  v_has_rejection boolean;
  v_return_txn_id bigint;
  v_return_id bigint;
  v_grn text;
  v_current_user_id uuid := auth.uid();
begin
  v_has_rejection := coalesce(p_rejected_quantity, 0) > 0;
  v_good_quantity := p_quantity - coalesce(p_rejected_quantity, 0);

  if p_order_id is null then
    raise exception 'process_supplier_order_receipt: order id is required';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'process_supplier_order_receipt: quantity must be greater than zero';
  end if;

  if v_has_rejection and (p_rejection_reason is null or trim(p_rejection_reason) = '') then
    raise exception 'process_supplier_order_receipt: rejection_reason is required when rejected_quantity > 0';
  end if;

  if v_good_quantity < 0 then
    raise exception 'process_supplier_order_receipt: rejected_quantity % exceeds total quantity %',
      p_rejected_quantity, p_quantity;
  end if;

  select
    so.order_id,
    so.org_id,
    so.supplier_component_id,
    so.purchase_order_id,
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

  if v_order.org_id is not null and auth.role() <> 'service_role' and not is_org_member(v_order.org_id) then
    raise exception 'process_supplier_order_receipt: access denied';
  end if;

  if v_order.supplier_component_id is null then
    raise exception 'process_supplier_order_receipt: supplier order % is missing supplier component id', p_order_id;
  end if;

  select sc.component_id, sc.price
  into v_comp_id, v_unit_cost
  from suppliercomponents sc
  where sc.supplier_component_id = v_order.supplier_component_id;

  if v_comp_id is null then
    raise exception 'process_supplier_order_receipt: component for supplier component % not found', v_order.supplier_component_id;
  end if;

  with receipt_total as (
    select coalesce(sum(quantity_received), 0) as total
    from supplier_order_receipts
    where supplier_order_receipts.order_id = p_order_id
  ),
  return_total as (
    select coalesce(sum(quantity_returned), 0) as total
    from supplier_order_returns
    where supplier_order_returns.supplier_order_id = p_order_id
  )
  select
    coalesce((select total from receipt_total), 0) - coalesce((select total from return_total), 0)
  into v_net_received_before;

  v_remaining := greatest(v_order.order_quantity - v_net_received_before, 0);

  if v_good_quantity > v_remaining then
    raise exception 'process_supplier_order_receipt: quantity % exceeds remaining % for order %',
      v_good_quantity, v_remaining, p_order_id;
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
    transaction_date,
    supplier_order_id,
    purchase_order_id,
    user_id,
    org_id,
    unit_cost
  ) values (
    v_comp_id,
    v_good_quantity,
    v_purch_type_id,
    v_receipt_ts,
    p_order_id,
    v_order.purchase_order_id,
    v_current_user_id,
    v_order.org_id,
    case
      when v_good_quantity > 0 and v_unit_cost is not null and v_unit_cost > 0 then v_unit_cost
      else null
    end
  )
  returning inventory_transactions.transaction_id into v_txn_id;

  insert into supplier_order_receipts (
    order_id,
    transaction_id,
    quantity_received,
    receipt_date,
    org_id
  ) values (
    p_order_id,
    v_txn_id,
    p_quantity,
    v_receipt_ts,
    v_order.org_id
  )
  returning * into v_new_receipt;

  if v_has_rejection then
    select transaction_type_id into v_return_type_id
    from transaction_types
    where type_name = 'RETURN'
    limit 1;

    if v_return_type_id is null then
      insert into transaction_types (type_name)
      values ('RETURN')
      on conflict (type_name) do update set type_name = excluded.type_name
      returning transaction_type_id into v_return_type_id;
    end if;

    insert into inventory_transactions (
      component_id,
      quantity,
      transaction_type_id,
      transaction_date,
      supplier_order_id,
      purchase_order_id,
      user_id,
      reason,
      org_id,
      unit_cost
    ) values (
      v_comp_id,
      -p_rejected_quantity,
      v_return_type_id,
      v_receipt_ts,
      p_order_id,
      v_order.purchase_order_id,
      v_current_user_id,
      p_rejection_reason,
      v_order.org_id,
      null
    )
    returning inventory_transactions.transaction_id into v_return_txn_id;

    v_grn := generate_goods_return_number(v_order.purchase_order_id);

    insert into supplier_order_returns (
      supplier_order_id,
      transaction_id,
      quantity_returned,
      return_date,
      reason,
      return_type,
      receipt_id,
      user_id,
      goods_return_number,
      org_id
    ) values (
      p_order_id,
      v_return_txn_id,
      p_rejected_quantity,
      v_receipt_ts,
      p_rejection_reason,
      'rejection',
      v_new_receipt.receipt_id,
      v_current_user_id,
      v_grn,
      v_order.org_id
    )
    returning supplier_order_returns.return_id into v_return_id;
  end if;

  select count(*)
  into v_alloc_count
  from (
    select 1
    from supplier_order_customer_orders
    where supplier_order_id = p_order_id
    for update
  ) locked_allocs;

  if p_allocation_receipts is not null then
    if jsonb_typeof(p_allocation_receipts) <> 'array' or jsonb_array_length(p_allocation_receipts) = 0 then
      raise exception 'process_supplier_order_receipt: allocation payload must be a non-empty array';
    end if;

    select
      count(*)::integer,
      count(distinct p.allocation_id)::integer,
      coalesce(sum(p.quantity), 0)
    into v_payload_count, v_payload_distinct_count, v_payload_sum
    from (
      select
        (elem->>'allocation_id')::integer as allocation_id,
        (elem->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_allocation_receipts) elem
    ) p;

    if v_payload_count <> v_payload_distinct_count then
      raise exception 'process_supplier_order_receipt: duplicate allocation_id in payload';
    end if;

    if exists (
      select 1
      from (
        select (elem->>'quantity')::numeric as quantity
        from jsonb_array_elements(p_allocation_receipts) elem
      ) p
      where p.quantity is null or p.quantity <= 0
    ) then
      raise exception 'process_supplier_order_receipt: each allocation quantity must be greater than zero';
    end if;

    if v_payload_sum <> v_good_quantity::numeric then
      raise exception 'process_supplier_order_receipt: allocation quantity sum % must equal receipt quantity %',
        v_payload_sum, v_good_quantity;
    end if;

    if exists (
      select 1
      from (
        select (elem->>'allocation_id')::integer as allocation_id
        from jsonb_array_elements(p_allocation_receipts) elem
      ) p
      left join supplier_order_customer_orders soco
        on soco.id = p.allocation_id
       and soco.supplier_order_id = p_order_id
      where soco.id is null
    ) then
      raise exception 'process_supplier_order_receipt: allocation payload contains rows not tied to order %', p_order_id;
    end if;

    update supplier_order_customer_orders soco
    set received_quantity = coalesce(soco.received_quantity, 0) + p.quantity
    from (
      select
        (elem->>'allocation_id')::integer as allocation_id,
        (elem->>'quantity')::numeric as quantity
      from jsonb_array_elements(p_allocation_receipts) elem
    ) p
    where soco.id = p.allocation_id
      and soco.supplier_order_id = p_order_id;

    if exists (
      select 1
      from supplier_order_customer_orders soco
      where soco.supplier_order_id = p_order_id
        and soco.received_quantity is not null
        and soco.received_quantity > coalesce(soco.quantity_for_order, 0) + coalesce(soco.quantity_for_stock, 0)
    ) then
      raise exception 'process_supplier_order_receipt: receipt exceeds allocation cap';
    end if;
  elsif v_alloc_count = 1 then
    update supplier_order_customer_orders soco
    set received_quantity = coalesce(soco.received_quantity, 0) + v_good_quantity
    where soco.supplier_order_id = p_order_id;

    if exists (
      select 1
      from supplier_order_customer_orders soco
      where soco.supplier_order_id = p_order_id
        and soco.received_quantity is not null
        and soco.received_quantity > coalesce(soco.quantity_for_order, 0) + coalesce(soco.quantity_for_stock, 0)
    ) then
      raise exception 'process_supplier_order_receipt: receipt exceeds allocation cap';
    end if;
  elsif v_alloc_count > 1 then
    if exists (
      select 1
      from supplier_order_customer_orders soco
      where soco.supplier_order_id = p_order_id
        and soco.received_quantity is not null
    ) then
      raise exception 'process_supplier_order_receipt: allocation breakdown required (tracking already started)';
    end if;
  end if;

  if v_good_quantity > 0 then
    insert into public.inventory (
      component_id,
      quantity_on_hand,
      location,
      reorder_level,
      org_id,
      average_cost
    )
    values (
      v_comp_id,
      v_good_quantity,
      null,
      0,
      v_order.org_id,
      case when v_unit_cost is not null and v_unit_cost > 0 then v_unit_cost else null end
    )
    on conflict (component_id) do update
    set
      quantity_on_hand = coalesce(public.inventory.quantity_on_hand, 0) + excluded.quantity_on_hand,
      average_cost = case
        when v_unit_cost is null or v_unit_cost <= 0 then public.inventory.average_cost
        when coalesce(public.inventory.quantity_on_hand, 0) <= 0
          or public.inventory.average_cost is null then v_unit_cost
        else (
          coalesce(public.inventory.quantity_on_hand, 0) * public.inventory.average_cost
          + excluded.quantity_on_hand * v_unit_cost
        ) / (coalesce(public.inventory.quantity_on_hand, 0) + excluded.quantity_on_hand)
      end
    returning public.inventory.quantity_on_hand into v_qty_on_hand;
  end if;

  if v_good_quantity = 0 then
    select coalesce((
      select quantity_on_hand
      from public.inventory
      where component_id = v_comp_id
    ), 0)
    into v_qty_on_hand;
  end if;

  with receipt_total as (
    select coalesce(sum(quantity_received), 0) as total
    from supplier_order_receipts
    where supplier_order_receipts.order_id = p_order_id
  ),
  return_total as (
    select coalesce(sum(quantity_returned), 0) as total
    from supplier_order_returns
    where supplier_order_returns.supplier_order_id = p_order_id
  )
  select
    coalesce((select total from receipt_total), 0) - coalesce((select total from return_total), 0)
  into v_tot_received;

  select supplier_order_statuses.status_id into v_comp_stat_id
  from supplier_order_statuses
  where lower(supplier_order_statuses.status_name) = 'fully received'
  limit 1;

  select supplier_order_statuses.status_id into v_part_stat_id
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
    v_qty_on_hand,
    v_return_id,
    v_grn;
end;
$function$;

grant execute on function public.process_supplier_order_receipt(
  integer,
  numeric,
  timestamp with time zone,
  text,
  jsonb,
  numeric,
  text,
  text,
  text
) to authenticated;

grant execute on function public.process_supplier_order_receipt(
  integer,
  numeric,
  timestamp with time zone,
  text,
  jsonb,
  numeric,
  text,
  text,
  text
) to service_role;
