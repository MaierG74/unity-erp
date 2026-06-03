-- Order-linked picking lists.
--
-- Extends the pending-picking-list feature so a saved picking list can belong to an ORDER
-- (customer today; internal once internal orders ship), not only a free external reference.
-- This supports picking stock for an order BEFORE the BOM/product exists: the list is saved,
-- "stays with" the order, and is issued later. Issuing an order-linked pick records the
-- issuance AGAINST the order (stock_issuances.order_id) via process_stock_issuance, with an
-- availability gate so you can never issue stock you don't have. Free (non-order) picks keep
-- the existing manual-issuance behaviour.

-- 1. order_id on the header (nullable). external_reference stays for free/legacy picks.
alter table public.pending_stock_issuances
  add column if not exists order_id integer references public.orders(order_id);
create index if not exists idx_pending_issuances_order on public.pending_stock_issuances(order_id);

-- 2. create_pending_stock_issuance gains p_order_id. Drop the old 5-arg overload first so the
--    new defaulted signature is unambiguous to PostgREST.
drop function if exists public.create_pending_stock_issuance(text, text, text, integer, text);

create or replace function public.create_pending_stock_issuance(
  p_components text,
  p_external_reference text default null,
  p_issue_category text default 'production',
  p_staff_id integer default null,
  p_notes text default null,
  p_order_id integer default null
)
returns table(success boolean, message text, pending_id integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_pending_id integer;
  v_comp record;
  v_count integer := 0;
  v_order_number text;
  v_ext text;
begin
  v_org := current_org_id();
  if v_org is null then
    return query select false, 'No organization context'::text, null::integer;
    return;
  end if;

  if p_order_id is not null then
    select o.order_number into v_order_number
    from public.orders o
    where o.order_id = p_order_id and o.org_id = v_org;
    if not found then
      return query select false, 'Order not found in your organization'::text, null::integer;
      return;
    end if;
  end if;

  -- An order-linked pick derives its reference from the order; a free pick must supply one.
  v_ext := coalesce(
    nullif(btrim(p_external_reference), ''),
    v_order_number,
    case when p_order_id is not null then 'Order #' || p_order_id else null end
  );
  if v_ext is null or btrim(v_ext) = '' then
    return query select false, 'An external reference or order is required'::text, null::integer;
    return;
  end if;

  if p_components is null or btrim(p_components) = '' then
    return query select false, 'No components provided'::text, null::integer;
    return;
  end if;

  insert into public.pending_stock_issuances (
    org_id, order_id, external_reference, issue_category, staff_id, notes, status, created_by
  ) values (
    v_org, p_order_id, v_ext,
    coalesce(nullif(btrim(p_issue_category), ''), 'production'),
    p_staff_id, p_notes, 'pending', auth.uid()
  )
  returning pending_stock_issuances.pending_id into v_pending_id;

  for v_comp in
    select x.component_id, x.quantity
    from jsonb_to_recordset(p_components::jsonb) as x(component_id integer, quantity numeric)
  loop
    if v_comp.component_id is null or v_comp.quantity is null or v_comp.quantity <= 0 then
      raise exception 'Invalid component line (component_id=%, quantity=%)', v_comp.component_id, v_comp.quantity;
    end if;
    if not exists (
      select 1 from public.components c
      where c.component_id = v_comp.component_id and c.org_id = v_org
    ) then
      raise exception 'Component % not found in your organization', v_comp.component_id;
    end if;

    insert into public.pending_stock_issuance_items (pending_id, component_id, quantity, org_id)
    values (v_pending_id, v_comp.component_id, v_comp.quantity, v_org);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No valid components provided';
  end if;

  return query select true, format('Picking list created with %s item(s)', v_count)::text, v_pending_id;
exception when others then
  return query select false, sqlerrm::text, null::integer;
end;
$$;

-- 3. complete_pending_stock_issuance: order-linked picks issue AGAINST the order
--    (process_stock_issuance, recorded on stock_issuances.order_id); free picks issue as manual.
--    Availability is gated in both paths.
create or replace function public.complete_pending_stock_issuance(
  p_pending_id integer
)
returns table(success boolean, message text, items_issued integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pending record;
  v_item record;
  v_result record;
  v_count integer := 0;
  v_missing text[];
  v_on_hand numeric;
begin
  select * into v_pending
  from public.pending_stock_issuances
  where pending_id = p_pending_id
  for update;

  if not found then
    return query select false, 'Picking list not found'::text, 0;
    return;
  end if;
  if not is_org_member(v_pending.org_id) then
    return query select false, 'Picking list belongs to another organization'::text, 0;
    return;
  end if;
  if v_pending.status <> 'pending' then
    return query select false, format('Picking list already %s', v_pending.status)::text, 0;
    return;
  end if;

  select array_agg(c.internal_code)
  into v_missing
  from public.pending_stock_issuance_items psi
  join public.components c on c.component_id = psi.component_id
  left join public.inventory i on i.component_id = psi.component_id
  where psi.pending_id = p_pending_id and i.inventory_id is null;

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    return query select false,
      format('Missing inventory records for: %s. Create inventory records first.', array_to_string(v_missing, ', '))::text,
      0;
    return;
  end if;

  for v_item in
    select psi.component_id, psi.quantity
    from public.pending_stock_issuance_items psi
    where psi.pending_id = p_pending_id
  loop
    if v_pending.order_id is not null then
      -- Availability gate: process_stock_issuance does not refuse a negative balance on its own.
      select i.quantity_on_hand into v_on_hand
      from public.inventory i where i.component_id = v_item.component_id
      for update;
      if coalesce(v_on_hand, 0) < v_item.quantity then
        raise exception 'PICK_ISSUE_FAILED: Insufficient stock for component % (have %, need %)',
          v_item.component_id, coalesce(v_on_hand, 0), v_item.quantity;
      end if;

      select * into v_result from public.process_stock_issuance(
        p_order_id          => v_pending.order_id,
        p_component_id      => v_item.component_id,
        p_quantity          => v_item.quantity,
        p_purchase_order_id => null,
        p_notes             => v_pending.notes,
        p_issuance_date     => now(),
        p_staff_id          => v_pending.staff_id
      );
    else
      select * into v_result from public.process_manual_stock_issuance(
        p_component_id       => v_item.component_id,
        p_quantity           => v_item.quantity,
        p_notes              => v_pending.notes,
        p_external_reference => v_pending.external_reference,
        p_issue_category     => v_pending.issue_category,
        p_staff_id           => v_pending.staff_id,
        p_issuance_date      => now()
      );
    end if;

    if not coalesce(v_result.success, false) then
      raise exception 'PICK_ISSUE_FAILED: %', coalesce(v_result.message, 'Unknown error issuing component');
    end if;

    v_count := v_count + 1;
  end loop;

  update public.pending_stock_issuances
  set status = 'issued', issued_at = now(), issued_by = auth.uid()
  where pending_id = p_pending_id;

  return query select true, 'Stock issued successfully'::text, v_count;
exception when others then
  return query select false, replace(sqlerrm, 'PICK_ISSUE_FAILED: ', '')::text, 0;
end;
$$;

-- 4. Grants for the new create overload.
revoke all on function public.create_pending_stock_issuance(text, text, text, integer, text, integer) from public, anon;
grant execute on function public.create_pending_stock_issuance(text, text, text, integer, text, integer) to authenticated;
