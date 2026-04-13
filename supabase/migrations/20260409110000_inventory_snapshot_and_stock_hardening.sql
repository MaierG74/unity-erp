-- Inventory stock-level hardening helpers:
-- 1. Distinct OPENING_BALANCE transaction type for seeded stock.
-- 2. Transaction-backed stock-level setter used by inventory edit UIs.

insert into public.transaction_types (type_name)
select 'OPENING_BALANCE'
where not exists (
  select 1 from public.transaction_types where type_name = 'OPENING_BALANCE'
);

drop function if exists public.record_component_stock_level(integer, numeric, text, text, timestamptz, text);

create or replace function public.record_component_stock_level(
  p_component_id integer,
  p_new_quantity numeric,
  p_reason text default null,
  p_notes text default null,
  p_transaction_date timestamptz default timezone('utc', now()),
  p_transaction_type text default 'ADJUSTMENT'
)
returns table(
  transaction_id bigint,
  previous_quantity numeric,
  new_quantity numeric,
  delta numeric,
  transaction_type_name text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_component record;
  v_inventory public.inventory%rowtype;
  v_previous_quantity numeric := 0;
  v_delta numeric := 0;
  v_transaction_type_name text := upper(trim(coalesce(p_transaction_type, 'ADJUSTMENT')));
  v_transaction_type_id bigint;
  v_transaction_id bigint;
  v_reason text;
  v_user_id uuid := auth.uid();
begin
  if p_component_id is null then
    raise exception 'record_component_stock_level: component id is required';
  end if;

  if p_new_quantity is null then
    raise exception 'record_component_stock_level: new quantity is required';
  end if;

  if p_new_quantity < 0 then
    raise exception 'record_component_stock_level: new quantity must be zero or greater';
  end if;

  if v_transaction_type_name not in ('ADJUSTMENT', 'OPENING_BALANCE') then
    raise exception 'record_component_stock_level: unsupported transaction type %', v_transaction_type_name;
  end if;

  select c.component_id, c.org_id
  into v_component
  from public.components c
  where c.component_id = p_component_id;

  if not found then
    raise exception 'record_component_stock_level: component % not found', p_component_id;
  end if;

  if v_component.org_id is not null
     and auth.role() <> 'service_role'
     and not public.is_org_member(v_component.org_id) then
    raise exception 'record_component_stock_level: access denied';
  end if;

  if v_transaction_type_name = 'OPENING_BALANCE'
     and exists (
       select 1
       from public.inventory_transactions it
       where it.component_id = p_component_id
     ) then
    raise exception 'record_component_stock_level: opening balance can only be recorded before any inventory transactions exist';
  end if;

  select *
  into v_inventory
  from public.inventory i
  where i.component_id = p_component_id
  for update;

  if found then
    v_previous_quantity := coalesce(v_inventory.quantity_on_hand, 0);
  end if;

  v_delta := p_new_quantity - v_previous_quantity;

  if v_delta = 0 then
    return query
    select
      null::bigint,
      v_previous_quantity,
      p_new_quantity,
      v_delta,
      v_transaction_type_name;
    return;
  end if;

  insert into public.transaction_types (type_name)
  values (v_transaction_type_name)
  on conflict (type_name)
  do update set type_name = excluded.type_name
  returning transaction_type_id into v_transaction_type_id;

  if v_transaction_type_id is null then
    select tt.transaction_type_id
    into v_transaction_type_id
    from public.transaction_types tt
    where tt.type_name = v_transaction_type_name;
  end if;

  v_reason := coalesce(
    nullif(trim(p_reason), ''),
    case
      when v_transaction_type_name = 'OPENING_BALANCE' then 'Opening Balance'
      else 'Stock Level Update'
    end
  );

  if p_notes is not null and trim(p_notes) <> '' then
    v_reason := format('%s: %s', v_reason, trim(p_notes));
  end if;

  insert into public.inventory_transactions (
    component_id,
    quantity,
    transaction_type_id,
    transaction_date,
    user_id,
    reason,
    org_id
  )
  values (
    p_component_id,
    v_delta,
    v_transaction_type_id,
    coalesce(p_transaction_date, timezone('utc', now())),
    v_user_id,
    v_reason,
    v_component.org_id
  )
  returning public.inventory_transactions.transaction_id into v_transaction_id;

  if found then
    update public.inventory
    set quantity_on_hand = p_new_quantity
    where inventory_id = v_inventory.inventory_id;
  else
    insert into public.inventory (
      component_id,
      quantity_on_hand,
      location,
      reorder_level,
      org_id
    )
    values (
      p_component_id,
      p_new_quantity,
      null,
      0,
      v_component.org_id
    );
  end if;

  return query
  select
    v_transaction_id::bigint,
    v_previous_quantity,
    p_new_quantity,
    v_delta,
    v_transaction_type_name;
end;
$function$;

comment on function public.record_component_stock_level(integer, numeric, text, text, timestamptz, text)
  is 'Sets component stock to a target quantity while recording the delta in inventory_transactions. Supports ADJUSTMENT and OPENING_BALANCE transaction types.';

grant execute on function public.record_component_stock_level(integer, numeric, text, text, timestamptz, text)
  to authenticated, service_role;
