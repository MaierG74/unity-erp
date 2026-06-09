-- Durable audit trail for stock issue sheet print/download/open requests.
--
-- This records the browser/app action ("print requested" / "download clicked"),
-- not physical printer success. The table is append-only for authenticated
-- users and org-scoped from the linked issuance/order/component context.

create table if not exists public.stock_issuance_print_requests (
  print_request_id bigint primary key generated always as identity,
  org_id uuid not null references public.organizations(id) on delete restrict,
  stock_issuance_id bigint references public.stock_issuances(issuance_id) on delete set null,
  order_id integer references public.orders(order_id) on delete set null,
  customer_id bigint,
  order_reference text,
  customer_name text,
  printed_by uuid default auth.uid() references auth.users(id) on delete set null,
  printed_at timestamptz not null default timezone('utc', now()),
  source text not null,
  request_action text not null default 'print',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint stock_issuance_print_requests_source_not_blank
    check (length(btrim(source)) > 0),
  constraint stock_issuance_print_requests_action_check
    check (request_action in ('print', 'download', 'open', 'preview')),
  constraint stock_issuance_print_requests_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_stock_issuance_print_requests_org_time
  on public.stock_issuance_print_requests(org_id, printed_at desc);

create index if not exists idx_stock_issuance_print_requests_issuance_time
  on public.stock_issuance_print_requests(stock_issuance_id, printed_at desc)
  where stock_issuance_id is not null;

create index if not exists idx_stock_issuance_print_requests_order_time
  on public.stock_issuance_print_requests(order_id, printed_at desc)
  where order_id is not null;

create index if not exists idx_stock_issuance_print_requests_user_time
  on public.stock_issuance_print_requests(printed_by, printed_at desc)
  where printed_by is not null;

create or replace function public.prepare_stock_issuance_print_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_issuance record;
  v_order record;
  v_resolved_org uuid;
begin
  new.printed_at := coalesce(new.printed_at, timezone('utc', now()));
  new.created_at := coalesce(new.created_at, timezone('utc', now()));
  new.printed_by := coalesce(new.printed_by, v_auth_uid);
  new.request_action := coalesce(nullif(btrim(new.request_action), ''), 'print');
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if auth.role() <> 'service_role' then
    if v_auth_uid is null then
      raise exception 'Authenticated user required to log stock issue print requests';
    end if;

    if new.printed_by is distinct from v_auth_uid then
      raise exception 'printed_by must match the authenticated user';
    end if;
  end if;

  if new.stock_issuance_id is not null then
    select
      si.issuance_id,
      si.order_id,
      si.component_id,
      si.external_reference,
      o.org_id as order_org_id,
      o.order_number,
      o.customer_id,
      c.org_id as component_org_id
    into v_issuance
    from public.stock_issuances si
    left join public.orders o on o.order_id = si.order_id
    left join public.components c on c.component_id = si.component_id
    where si.issuance_id = new.stock_issuance_id;

    if not found then
      raise exception 'Stock issuance % not found', new.stock_issuance_id;
    end if;

    v_resolved_org := coalesce(v_issuance.order_org_id, v_issuance.component_org_id);
    if v_resolved_org is null then
      raise exception 'Unable to resolve organization for stock issuance %', new.stock_issuance_id;
    end if;

    if new.org_id is null then
      new.org_id := v_resolved_org;
    elsif new.org_id <> v_resolved_org then
      raise exception 'Print request organization does not match stock issuance organization';
    end if;

    if v_issuance.order_id is not null and new.order_id is not null and new.order_id <> v_issuance.order_id then
      raise exception 'Print request order does not match stock issuance order';
    end if;

    new.order_id := coalesce(new.order_id, v_issuance.order_id);
    new.order_reference := coalesce(
      nullif(btrim(new.order_reference), ''),
      nullif(btrim(v_issuance.order_number), ''),
      nullif(btrim(v_issuance.external_reference), '')
    );
    new.customer_id := coalesce(new.customer_id, v_issuance.customer_id);
  end if;

  if new.order_id is not null then
    select o.org_id, o.order_number, o.customer_id
    into v_order
    from public.orders o
    where o.order_id = new.order_id;

    if found then
      if new.org_id is null then
        new.org_id := v_order.org_id;
      elsif new.org_id <> v_order.org_id then
        raise exception 'Print request organization does not match order organization';
      end if;

      new.order_reference := coalesce(nullif(btrim(new.order_reference), ''), nullif(btrim(v_order.order_number), ''));
      new.customer_id := coalesce(new.customer_id, v_order.customer_id);
    end if;
  end if;

  new.org_id := coalesce(new.org_id, public.current_org_id());
  if new.org_id is null then
    raise exception 'Organization context is required to log stock issue print requests';
  end if;

  if auth.role() <> 'service_role' and not public.is_org_member(new.org_id) then
    raise exception 'User is not an active member of the print request organization';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prepare_stock_issuance_print_request
  on public.stock_issuance_print_requests;

create trigger trg_prepare_stock_issuance_print_request
before insert on public.stock_issuance_print_requests
for each row
execute function public.prepare_stock_issuance_print_request();

alter table public.stock_issuance_print_requests enable row level security;

revoke all on public.stock_issuance_print_requests from anon, authenticated;
grant select, insert on public.stock_issuance_print_requests to authenticated;
grant all on public.stock_issuance_print_requests to service_role;

drop policy if exists stock_issuance_print_requests_select_org_member
  on public.stock_issuance_print_requests;
drop policy if exists stock_issuance_print_requests_insert_org_member
  on public.stock_issuance_print_requests;

create policy stock_issuance_print_requests_select_org_member
on public.stock_issuance_print_requests
for select
to authenticated
using (public.is_org_member(org_id));

create policy stock_issuance_print_requests_insert_org_member
on public.stock_issuance_print_requests
for insert
to authenticated
with check (
  public.is_org_member(org_id)
  and printed_by = auth.uid()
);

comment on table public.stock_issuance_print_requests is
  'Append-only audit trail for stock issue sheet print/download/open requests. Records app/browser request only, not physical printer success.';
comment on column public.stock_issuance_print_requests.stock_issuance_id is
  'Linked stock_issuances row when the print request is for an issued stock sheet.';
comment on column public.stock_issuance_print_requests.printed_by is
  'Authenticated user who clicked the print/open/download action.';
comment on column public.stock_issuance_print_requests.printed_at is
  'Timestamp when the app recorded the print/open/download request.';
comment on column public.stock_issuance_print_requests.source is
  'UI source/context that logged the request, for example order_issue_history_group or manual_issue_history.';
comment on column public.stock_issuance_print_requests.request_action is
  'User action requested by the browser/app: print, download, open, or preview. This does not confirm physical printer success.';
comment on column public.stock_issuance_print_requests.metadata is
  'Optional structured context such as component ids, grouped issuance ids, quantities, file name, or document type.';
