begin;

create table if not exists public.bom_swap_exceptions (
  exception_id bigserial primary key,
  org_id uuid not null references public.organizations(id),
  order_id integer not null references public.orders(order_id),
  order_detail_id integer not null references public.order_details(order_detail_id),
  source_bom_id integer not null,
  exception_type text not null check (exception_type in (
    'bom_swapped_after_downstream_event'
  )),
  status text not null check (status in ('open','acknowledged','resolved')),

  swap_kind_before text not null,
  swap_kind_after text not null,
  effective_component_id_before integer,
  effective_component_id_after integer,
  effective_component_code_before text,
  effective_component_code_after text,
  effective_quantity_before numeric,
  effective_quantity_after numeric,
  surcharge_amount_before numeric,
  surcharge_amount_after numeric,

  downstream_evidence jsonb not null default '{}',

  triggered_by uuid references auth.users,
  triggered_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users,
  acknowledged_at timestamptz,
  resolution_type text check (resolution_type in (
    'accept_swap_no_action',
    'cancel_or_amend_po',
    'return_old_stock_to_inventory',
    'accept_swap_with_rework'
  )),
  resolution_notes text,
  resolved_by uuid references auth.users,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_bom_swap_exceptions_open_unique
  on public.bom_swap_exceptions (order_detail_id, source_bom_id, exception_type)
  where status in ('open','acknowledged');

create index if not exists idx_bom_swap_exceptions_queue
  on public.bom_swap_exceptions (org_id, status, exception_type, triggered_at desc);

alter table public.bom_swap_exceptions enable row level security;

drop policy if exists bom_swap_exceptions_org_select on public.bom_swap_exceptions;
create policy bom_swap_exceptions_org_select on public.bom_swap_exceptions
  for select using (public.is_org_member(org_id));

drop policy if exists bom_swap_exceptions_org_insert on public.bom_swap_exceptions;
create policy bom_swap_exceptions_org_insert on public.bom_swap_exceptions
  for insert with check (public.is_org_member(org_id));

drop policy if exists bom_swap_exceptions_org_update on public.bom_swap_exceptions;
create policy bom_swap_exceptions_org_update on public.bom_swap_exceptions
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop trigger if exists bom_swap_exceptions_set_updated_at on public.bom_swap_exceptions;
create trigger bom_swap_exceptions_set_updated_at
before update on public.bom_swap_exceptions
for each row execute function public.set_current_timestamp();

create table if not exists public.bom_swap_exception_activity (
  activity_id bigserial primary key,
  exception_id bigint not null references public.bom_swap_exceptions(exception_id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  event_type text not null check (event_type in (
    'created',
    'swap_applied',
    'acknowledged',
    'resolution_selected',
    'resolved',
    'auto_resolved'
  )),
  performed_by uuid references auth.users,
  notes text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_bom_swap_exception_activity_lookup
  on public.bom_swap_exception_activity (exception_id, created_at desc);

alter table public.bom_swap_exception_activity enable row level security;

drop policy if exists bom_swap_exception_activity_org_select on public.bom_swap_exception_activity;
create policy bom_swap_exception_activity_org_select on public.bom_swap_exception_activity
  for select using (public.is_org_member(org_id));

drop policy if exists bom_swap_exception_activity_org_insert on public.bom_swap_exception_activity;
create policy bom_swap_exception_activity_org_insert on public.bom_swap_exception_activity
  for insert with check (public.is_org_member(org_id));

create or replace function public.upsert_bom_swap_exception(
  p_order_detail_id integer,
  p_source_bom_id integer,
  p_swap_event jsonb,
  p_downstream_evidence jsonb,
  p_user uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_detail record;
  v_existing_exception_id bigint;
  v_exception_id bigint;
  v_event_type text;
  v_payload jsonb;
begin
  select od.order_detail_id, od.order_id, od.org_id
    into v_detail
  from public.order_details od
  where od.order_detail_id = p_order_detail_id
  for share;

  if not found then
    raise exception 'upsert_bom_swap_exception: order_detail_id % not found', p_order_detail_id;
  end if;

  if auth.role() <> 'service_role' and not public.is_org_member(v_detail.org_id) then
    raise exception 'upsert_bom_swap_exception: not authorized for org %', v_detail.org_id;
  end if;

  select bse.exception_id
    into v_existing_exception_id
  from public.bom_swap_exceptions bse
  where bse.order_detail_id = p_order_detail_id
    and bse.source_bom_id = p_source_bom_id
    and bse.exception_type = 'bom_swapped_after_downstream_event'
    and bse.status in ('open','acknowledged')
  for update;

  v_payload := coalesce(p_swap_event, '{}'::jsonb)
    || jsonb_build_object(
      'order_detail_id', p_order_detail_id,
      'source_bom_id', p_source_bom_id,
      'downstream_evidence_at_event', coalesce(p_downstream_evidence, '{}'::jsonb)
    );

  if v_existing_exception_id is null then
    insert into public.bom_swap_exceptions (
      org_id,
      order_id,
      order_detail_id,
      source_bom_id,
      exception_type,
      status,
      swap_kind_before,
      swap_kind_after,
      effective_component_id_before,
      effective_component_id_after,
      effective_component_code_before,
      effective_component_code_after,
      effective_quantity_before,
      effective_quantity_after,
      surcharge_amount_before,
      surcharge_amount_after,
      downstream_evidence,
      triggered_by
    )
    values (
      v_detail.org_id,
      v_detail.order_id,
      p_order_detail_id,
      p_source_bom_id,
      'bom_swapped_after_downstream_event',
      'open',
      coalesce(nullif(p_swap_event->>'swap_kind_before', ''), 'default'),
      coalesce(nullif(p_swap_event->>'swap_kind_after', ''), 'default'),
      nullif(p_swap_event->>'effective_component_id_before', '')::integer,
      nullif(p_swap_event->>'effective_component_id_after', '')::integer,
      nullif(p_swap_event->>'effective_component_code_before', ''),
      nullif(p_swap_event->>'effective_component_code_after', ''),
      nullif(p_swap_event->>'effective_quantity_before', '')::numeric,
      nullif(p_swap_event->>'effective_quantity_after', '')::numeric,
      coalesce(nullif(p_swap_event->>'surcharge_amount_before', '')::numeric, 0),
      coalesce(nullif(p_swap_event->>'surcharge_amount_after', '')::numeric, 0),
      coalesce(p_downstream_evidence, '{}'::jsonb),
      p_user
    )
    returning exception_id into v_exception_id;

    v_event_type := 'created';
  else
    update public.bom_swap_exceptions
    set updated_at = now()
    where exception_id = v_existing_exception_id
    returning exception_id into v_exception_id;

    v_event_type := 'swap_applied';
  end if;

  insert into public.bom_swap_exception_activity (
    exception_id,
    org_id,
    event_type,
    performed_by,
    payload
  )
  values (
    v_exception_id,
    v_detail.org_id,
    v_event_type,
    p_user,
    v_payload
  );

  return v_exception_id;
end;
$$;

grant execute on function public.upsert_bom_swap_exception(integer, integer, jsonb, jsonb, uuid) to authenticated;
grant execute on function public.upsert_bom_swap_exception(integer, integer, jsonb, jsonb, uuid) to service_role;

commit;
