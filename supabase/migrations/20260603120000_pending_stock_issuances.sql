-- Pending Stock Issuances (Picking List) workflow — canonical, org-scoped, hardened.
--
-- Revives a feature whose UI (components/features/inventory/ManualStockIssueTab.tsx) was
-- merged into codex/integration but never functioned, because its backing migration lived in
-- the non-canonical root migrations/20251208_create_missing_inventory_records.sql and was never
-- applied. That orphan version had two production problems this migration fixes:
--   1. RLS was USING(true) WITH CHECK(true) — a multi-tenant leak (every org saw every list).
--   2. complete_pending re-inlined the on-hand decrement instead of reusing the hardened
--      process_manual_stock_issuance primitive (FOR UPDATE lock + availability gate).
--
-- Lifecycle (answers the product question "pick without issuing"):
--   Save as Picking List  -> status = 'pending'   : NO inventory effect (pure draft worklist).
--   [staff physically pull stock using the printed list]
--   Issue / Complete      -> status = 'issued'     : decrements quantity_on_hand + writes the
--                                                     ISSUE ledger row + stock_issuances row,
--                                                     per line, via process_manual_stock_issuance.
--   Cancel                -> status = 'cancelled'  : no inventory effect, ever.
--
-- Double-claim safety: process_manual_stock_issuance refuses to drive on-hand negative, so two
-- pending lists claiming the same stock can never BOTH complete — the second fails at issue time
-- with "Insufficient stock". Surfacing pending-claimed quantity in the picker UI (so operators see
-- the conflict before completing) is a deliberate follow-up, not handled here.

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
create table if not exists public.pending_stock_issuances (
  pending_id          serial primary key,
  org_id              uuid not null,
  external_reference  text not null,
  issue_category      text not null default 'production',
  staff_id            integer references public.staff(staff_id),
  notes               text,
  status              text not null default 'pending'
                        check (status in ('pending', 'issued', 'cancelled')),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  issued_at           timestamptz,
  issued_by           uuid,
  cancelled_at        timestamptz,
  cancelled_by        uuid
);

create table if not exists public.pending_stock_issuance_items (
  item_id      serial primary key,
  pending_id   integer not null references public.pending_stock_issuances(pending_id) on delete cascade,
  component_id integer not null references public.components(component_id),
  quantity     numeric not null check (quantity > 0),
  org_id       uuid not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_pending_issuances_status        on public.pending_stock_issuances(status);
create index if not exists idx_pending_issuances_org           on public.pending_stock_issuances(org_id);
create index if not exists idx_pending_issuances_external_ref  on public.pending_stock_issuances(external_reference);
create index if not exists idx_pending_issuance_items_pending  on public.pending_stock_issuance_items(pending_id);
create index if not exists idx_pending_issuance_items_org      on public.pending_stock_issuance_items(org_id);
create index if not exists idx_pending_issuance_items_component on public.pending_stock_issuance_items(component_id);

-- ===========================================================================
-- 2. RLS — modern org pattern (is_org_member(org_id)), mirrors job_work_pool.
--    Direct reads (PostgREST embed in the UI) rely on these; the RPCs below are
--    SECURITY DEFINER and set org_id from current_org_id() on write.
-- ===========================================================================
alter table public.pending_stock_issuances enable row level security;
alter table public.pending_stock_issuance_items enable row level security;

drop policy if exists org_read_pending_issuances   on public.pending_stock_issuances;
drop policy if exists org_insert_pending_issuances on public.pending_stock_issuances;
drop policy if exists org_update_pending_issuances on public.pending_stock_issuances;
drop policy if exists org_delete_pending_issuances on public.pending_stock_issuances;

create policy org_read_pending_issuances on public.pending_stock_issuances
  for select using (is_org_member(org_id));
create policy org_insert_pending_issuances on public.pending_stock_issuances
  for insert with check (is_org_member(org_id));
create policy org_update_pending_issuances on public.pending_stock_issuances
  for update using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy org_delete_pending_issuances on public.pending_stock_issuances
  for delete using (is_org_member(org_id));

drop policy if exists org_read_pending_issuance_items   on public.pending_stock_issuance_items;
drop policy if exists org_insert_pending_issuance_items on public.pending_stock_issuance_items;
drop policy if exists org_update_pending_issuance_items on public.pending_stock_issuance_items;
drop policy if exists org_delete_pending_issuance_items on public.pending_stock_issuance_items;

create policy org_read_pending_issuance_items on public.pending_stock_issuance_items
  for select using (is_org_member(org_id));
create policy org_insert_pending_issuance_items on public.pending_stock_issuance_items
  for insert with check (is_org_member(org_id));
create policy org_update_pending_issuance_items on public.pending_stock_issuance_items
  for update using (is_org_member(org_id)) with check (is_org_member(org_id));
create policy org_delete_pending_issuance_items on public.pending_stock_issuance_items
  for delete using (is_org_member(org_id));

-- ===========================================================================
-- 3. create_inventory_for_component — ensure an inventory row exists (org-scoped).
--    Used by the "missing inventory" dialog before a picking list can be issued.
-- ===========================================================================
create or replace function public.create_inventory_for_component(
  p_component_id integer,
  p_initial_quantity numeric default 0
)
returns table(success boolean, message text, inventory_id integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_comp_org uuid;
  v_inventory_id integer;
begin
  select c.org_id into v_comp_org from public.components c where c.component_id = p_component_id;
  if v_comp_org is null then
    return query select false, 'Component not found'::text, null::integer;
    return;
  end if;
  if not is_org_member(v_comp_org) then
    return query select false, 'Component belongs to another organization'::text, null::integer;
    return;
  end if;

  select i.inventory_id into v_inventory_id from public.inventory i where i.component_id = p_component_id;
  if v_inventory_id is not null then
    return query select true, 'Inventory record already exists'::text, v_inventory_id;
    return;
  end if;

  insert into public.inventory (component_id, quantity_on_hand, org_id)
  values (p_component_id, coalesce(p_initial_quantity, 0), v_comp_org)
  returning inventory.inventory_id into v_inventory_id;

  return query select true, 'Inventory record created'::text, v_inventory_id;
exception when others then
  return query select false, sqlerrm::text, null::integer;
end;
$$;

-- ===========================================================================
-- 4. create_pending_stock_issuance — "Save as Picking List". NO inventory effect.
--    p_components is a JSON *string* (UI sends JSON.stringify([{component_id, quantity}])),
--    so the param is text and parsed with ::jsonb here.
-- ===========================================================================
create or replace function public.create_pending_stock_issuance(
  p_components text,
  p_external_reference text,
  p_issue_category text default 'production',
  p_staff_id integer default null,
  p_notes text default null
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
begin
  v_org := current_org_id();
  if v_org is null then
    return query select false, 'No organization context'::text, null::integer;
    return;
  end if;
  if p_external_reference is null or btrim(p_external_reference) = '' then
    return query select false, 'External reference is required'::text, null::integer;
    return;
  end if;
  if p_components is null or btrim(p_components) = '' then
    return query select false, 'No components provided'::text, null::integer;
    return;
  end if;

  insert into public.pending_stock_issuances (
    org_id, external_reference, issue_category, staff_id, notes, status, created_by
  ) values (
    v_org,
    btrim(p_external_reference),
    coalesce(nullif(btrim(p_issue_category), ''), 'production'),
    p_staff_id,
    p_notes,
    'pending',
    auth.uid()
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
  -- The whole INSERT (header + items) rolls back atomically on any failure.
  return query select false, sqlerrm::text, null::integer;
end;
$$;

-- ===========================================================================
-- 5. complete_pending_stock_issuance — "Issue Stock" after picking.
--    Atomic, idempotent (status guard), reuses the hardened per-line issue primitive
--    (FOR UPDATE lock + availability gate), then marks the list issued.
-- ===========================================================================
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

  -- Friendly pre-check: every component must have an inventory row.
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
    select * into v_result
    from public.process_manual_stock_issuance(
      p_component_id       => v_item.component_id,
      p_quantity           => v_item.quantity,
      p_notes              => v_pending.notes,
      p_external_reference => v_pending.external_reference,
      p_issue_category     => v_pending.issue_category,
      p_staff_id           => v_pending.staff_id,
      p_issuance_date      => now()
    );

    if not coalesce(v_result.success, false) then
      -- Abort the entire completion; everything issued so far in this txn rolls back.
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

-- ===========================================================================
-- 6. cancel_pending_stock_issuance — discard a picking list. No inventory effect.
-- ===========================================================================
create or replace function public.cancel_pending_stock_issuance(
  p_pending_id integer
)
returns table(success boolean, message text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pending record;
begin
  select * into v_pending
  from public.pending_stock_issuances
  where pending_id = p_pending_id
  for update;

  if not found then
    return query select false, 'Picking list not found'::text;
    return;
  end if;
  if not is_org_member(v_pending.org_id) then
    return query select false, 'Picking list belongs to another organization'::text;
    return;
  end if;
  if v_pending.status <> 'pending' then
    return query select false, format('Picking list already %s', v_pending.status)::text;
    return;
  end if;

  update public.pending_stock_issuances
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where pending_id = p_pending_id;

  return query select true, 'Picking list cancelled'::text;
end;
$$;

-- ===========================================================================
-- 7. Grants — authenticated only; never anon.
-- ===========================================================================
revoke all on function public.create_inventory_for_component(integer, numeric) from public, anon;
revoke all on function public.create_pending_stock_issuance(text, text, text, integer, text) from public, anon;
revoke all on function public.complete_pending_stock_issuance(integer) from public, anon;
revoke all on function public.cancel_pending_stock_issuance(integer) from public, anon;

grant execute on function public.create_inventory_for_component(integer, numeric) to authenticated;
grant execute on function public.create_pending_stock_issuance(text, text, text, integer, text) to authenticated;
grant execute on function public.complete_pending_stock_issuance(integer) to authenticated;
grant execute on function public.cancel_pending_stock_issuance(integer) to authenticated;
