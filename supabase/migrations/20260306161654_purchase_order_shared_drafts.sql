-- Shared org-scoped purchase-order drafts for the manual purchasing workflow.
-- Drafts autosave independently from live purchase_orders so incomplete work is
-- recoverable without polluting operational purchasing data.

begin;

create table if not exists public.purchase_order_drafts (
  draft_id bigint generated always as identity primary key,
  org_id uuid not null default public.current_org_id(),
  title text,
  order_date date,
  notes text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'converting', 'converted', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz,
  converted_at timestamptz,
  converted_purchase_order_ids bigint[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_drafts_org_id_fkey
    foreign key (org_id) references public.organizations(id),
  constraint purchase_order_drafts_draft_org_unique unique (draft_id, org_id)
);

create table if not exists public.purchase_order_draft_lines (
  draft_line_id bigint generated always as identity primary key,
  draft_id bigint not null,
  org_id uuid not null default public.current_org_id(),
  sort_order integer not null default 0,
  component_id integer references public.components(component_id) on delete set null,
  supplier_component_id integer references public.suppliercomponents(supplier_component_id) on delete set null,
  quantity numeric,
  customer_order_id integer references public.orders(order_id) on delete set null,
  allocations jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_draft_lines_qty_nonnegative
    check (quantity is null or quantity > 0),
  constraint purchase_order_draft_lines_allocations_array
    check (jsonb_typeof(allocations) = 'array'),
  constraint purchase_order_draft_lines_draft_org_fkey
    foreign key (draft_id, org_id)
    references public.purchase_order_drafts(draft_id, org_id)
    on delete cascade
);

create index if not exists purchase_order_drafts_org_status_updated_idx
  on public.purchase_order_drafts (org_id, status, updated_at desc);
create index if not exists purchase_order_drafts_updated_by_idx
  on public.purchase_order_drafts (updated_by, updated_at desc);
create index if not exists purchase_order_draft_lines_draft_sort_idx
  on public.purchase_order_draft_lines (draft_id, sort_order);
create index if not exists purchase_order_draft_lines_org_idx
  on public.purchase_order_draft_lines (org_id);

drop trigger if exists purchase_order_drafts_set_updated_at on public.purchase_order_drafts;
create trigger purchase_order_drafts_set_updated_at
before update on public.purchase_order_drafts
for each row execute function public.set_current_timestamp();

drop trigger if exists purchase_order_draft_lines_set_updated_at on public.purchase_order_draft_lines;
create trigger purchase_order_draft_lines_set_updated_at
before update on public.purchase_order_draft_lines
for each row execute function public.set_current_timestamp();

alter table public.purchase_order_drafts enable row level security;
alter table public.purchase_order_draft_lines enable row level security;

drop policy if exists purchase_order_drafts_select_org_member on public.purchase_order_drafts;
create policy purchase_order_drafts_select_org_member
on public.purchase_order_drafts
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_drafts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_drafts_insert_org_member on public.purchase_order_drafts;
create policy purchase_order_drafts_insert_org_member
on public.purchase_order_drafts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_drafts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_drafts_update_org_member on public.purchase_order_drafts;
create policy purchase_order_drafts_update_org_member
on public.purchase_order_drafts
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_drafts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_drafts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_drafts_delete_org_member on public.purchase_order_drafts;
create policy purchase_order_drafts_delete_org_member
on public.purchase_order_drafts
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_drafts.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_draft_lines_select_org_member on public.purchase_order_draft_lines;
create policy purchase_order_draft_lines_select_org_member
on public.purchase_order_draft_lines
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_draft_lines.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_draft_lines_insert_org_member on public.purchase_order_draft_lines;
create policy purchase_order_draft_lines_insert_org_member
on public.purchase_order_draft_lines
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_draft_lines.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_draft_lines_update_org_member on public.purchase_order_draft_lines;
create policy purchase_order_draft_lines_update_org_member
on public.purchase_order_draft_lines
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_draft_lines.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_draft_lines.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists purchase_order_draft_lines_delete_org_member on public.purchase_order_draft_lines;
create policy purchase_order_draft_lines_delete_org_member
on public.purchase_order_draft_lines
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_draft_lines.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create or replace function public.save_purchase_order_draft(
  p_draft_id bigint default null,
  p_expected_version integer default null,
  p_title text default null,
  p_order_date date default null,
  p_notes text default '',
  p_lines jsonb default '[]'::jsonb
) returns table (
  draft_id bigint,
  version integer,
  updated_at timestamptz,
  updated_by uuid,
  locked_by uuid,
  locked_at timestamptz,
  status text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_user_id uuid := auth.uid();
  v_draft public.purchase_order_drafts%rowtype;
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'You must be signed in to save a purchase-order draft';
  end if;

  if v_org_id is null then
    raise exception 'No active organization context found for this user';
  end if;

  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  if p_draft_id is null then
    insert into public.purchase_order_drafts (
      org_id,
      title,
      order_date,
      notes,
      status,
      version,
      created_by,
      updated_by,
      locked_by,
      locked_at
    )
    values (
      v_org_id,
      nullif(btrim(coalesce(p_title, '')), ''),
      p_order_date,
      coalesce(p_notes, ''),
      'draft',
      1,
      v_user_id,
      v_user_id,
      v_user_id,
      now()
    )
    returning *
    into v_draft;
  else
    select *
    into v_draft
    from public.purchase_order_drafts d
    where d.draft_id = p_draft_id
      and d.org_id = v_org_id
      and d.status = 'draft'
    for update;

    if not found then
      raise exception 'Purchase-order draft % was not found or is no longer editable', p_draft_id;
    end if;

    if p_expected_version is not null and v_draft.version <> p_expected_version then
      raise exception 'Draft version conflict. Please reload the latest draft before saving.';
    end if;

    update public.purchase_order_drafts
    set title = nullif(btrim(coalesce(p_title, '')), ''),
        order_date = p_order_date,
        notes = coalesce(p_notes, ''),
        version = v_draft.version + 1,
        updated_by = v_user_id,
        locked_by = v_user_id,
        locked_at = now()
    where draft_id = p_draft_id
      and org_id = v_org_id
    returning *
    into v_draft;

    delete from public.purchase_order_draft_lines
    where draft_id = v_draft.draft_id
      and org_id = v_org_id;
  end if;

  insert into public.purchase_order_draft_lines (
    draft_id,
    org_id,
    sort_order,
    component_id,
    supplier_component_id,
    quantity,
    customer_order_id,
    allocations,
    notes,
    created_by,
    updated_by
  )
  select
    v_draft.draft_id,
    v_org_id,
    coalesce((line.value->>'sort_order')::integer, line.ordinality::integer - 1),
    nullif((line.value->>'component_id')::integer, 0),
    nullif((line.value->>'supplier_component_id')::integer, 0),
    (line.value->>'quantity')::numeric,
    nullif((line.value->>'customer_order_id')::integer, 0),
    coalesce(line.value->'allocations', '[]'::jsonb),
    coalesce(line.value->>'notes', ''),
    v_user_id,
    v_user_id
  from jsonb_array_elements(v_lines) with ordinality as line(value, ordinality);

  return query
  select
    v_draft.draft_id,
    v_draft.version,
    v_draft.updated_at,
    v_draft.updated_by,
    v_draft.locked_by,
    v_draft.locked_at,
    v_draft.status;
end;
$$;

create or replace function public.set_purchase_order_draft_status(
  p_draft_id bigint,
  p_status text,
  p_purchase_order_ids bigint[] default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid := public.current_org_id();
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in to update a purchase-order draft';
  end if;

  if v_org_id is null then
    raise exception 'No active organization context found for this user';
  end if;

  if p_status not in ('archived', 'converted') then
    raise exception 'Unsupported purchase-order draft status: %', p_status;
  end if;

  update public.purchase_order_drafts
  set status = p_status,
      updated_by = v_user_id,
      locked_by = null,
      locked_at = null,
      version = version + 1,
      converted_at = case when p_status = 'converted' then now() else converted_at end,
      converted_purchase_order_ids = case when p_status = 'converted' then p_purchase_order_ids else converted_purchase_order_ids end
  where draft_id = p_draft_id
    and org_id = v_org_id
    and status = 'draft';

  if not found then
    raise exception 'Purchase-order draft % was not found or is no longer editable', p_draft_id;
  end if;
end;
$$;

grant execute on function public.save_purchase_order_draft(bigint, integer, text, date, text, jsonb)
to authenticated, service_role;
grant execute on function public.set_purchase_order_draft_status(bigint, text, bigint[])
to authenticated, service_role;

drop function if exists public.create_purchase_order_with_lines(integer, jsonb, integer, timestamptz, text);

create or replace function public.create_purchase_order_with_lines(
    supplier_id integer,
    line_items jsonb,
    status_id integer default null,
    order_date timestamptz default now(),
    notes text default ''
) returns table (
    purchase_order_id integer,
    supplier_order_ids integer[]
)
language plpgsql
as $$
declare
    resolved_status_id integer := status_id;
    actual_order_date timestamptz := coalesce(order_date, now());
    new_purchase_order_id integer;
    inserted_ids integer[] := '{}';
    line jsonb;
    new_order_id integer;
    alloc jsonb;
    alloc_sum numeric;
    line_qty numeric;
begin
    if line_items is null or jsonb_typeof(line_items) <> 'array' or jsonb_array_length(line_items) = 0 then
        raise exception 'line_items payload must be a non-empty array';
    end if;

    if resolved_status_id is null then
        select sos.status_id
        into resolved_status_id
        from supplier_order_statuses sos
        where sos.status_name = 'Draft'
        limit 1;

        if resolved_status_id is null then
            raise exception 'Could not resolve status_id for Draft supplier orders';
        end if;
    end if;

    insert into purchase_orders (supplier_id, status_id, order_date, notes, created_by)
    values (supplier_id, resolved_status_id, actual_order_date, notes, auth.uid())
    returning purchase_orders.purchase_order_id
    into new_purchase_order_id;

    for line in select * from jsonb_array_elements(line_items)
    loop
        insert into supplier_orders (
            supplier_component_id, order_quantity, order_date,
            status_id, total_received, purchase_order_id
        ) values (
            (line->>'supplier_component_id')::integer,
            (line->>'order_quantity')::numeric,
            actual_order_date,
            resolved_status_id,
            0,
            new_purchase_order_id
        ) returning supplier_orders.order_id into new_order_id;

        inserted_ids := inserted_ids || new_order_id;
        line_qty := (line->>'order_quantity')::numeric;

        if line ? 'allocations' and jsonb_typeof(line->'allocations') = 'array'
           and jsonb_array_length(line->'allocations') > 0 then

            alloc_sum := 0;
            for alloc in select * from jsonb_array_elements(line->'allocations')
            loop
                alloc_sum := alloc_sum + (alloc->>'quantity_for_order')::numeric;
            end loop;

            if alloc_sum > line_qty then
                raise exception 'Allocation total (%) exceeds line quantity (%) for supplier_component_id %',
                    alloc_sum, line_qty, (line->>'supplier_component_id');
            end if;

            for alloc in select * from jsonb_array_elements(line->'allocations')
            loop
                insert into supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) values (
                    new_order_id,
                    (alloc->>'customer_order_id')::integer,
                    (line->>'component_id')::integer,
                    (alloc->>'quantity_for_order')::numeric,
                    0
                );
            end loop;

            if alloc_sum < line_qty then
                insert into supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) values (
                    new_order_id,
                    null,
                    (line->>'component_id')::integer,
                    0,
                    line_qty - alloc_sum
                );
            end if;
        else
            insert into supplier_order_customer_orders (
                supplier_order_id, order_id, component_id,
                quantity_for_order, quantity_for_stock
            ) values (
                new_order_id,
                (line->>'customer_order_id')::integer,
                (line->>'component_id')::integer,
                coalesce((line->>'quantity_for_order')::numeric, 0),
                coalesce((line->>'quantity_for_stock')::numeric, 0)
            );
        end if;
    end loop;

    for line in select * from jsonb_array_elements(line_items)
    loop
        if line->>'line_notes' is not null and line->>'line_notes' <> '' then
            update supplier_orders
            set notes = line->>'line_notes'
            where purchase_order_id = new_purchase_order_id
              and supplier_component_id = (line->>'supplier_component_id')::integer;
        end if;
    end loop;

    return query select new_purchase_order_id, inserted_ids;
end;
$$;

grant execute on function public.create_purchase_order_with_lines(integer, jsonb, integer, timestamptz, text)
to authenticated, service_role;

commit;
