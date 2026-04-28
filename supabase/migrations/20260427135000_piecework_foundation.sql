begin;

create table if not exists public.piecework_activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code in ('cut_pieces', 'edge_bundles')),
  label text not null,
  default_rate numeric(10, 2) not null check (default_rate >= 0),
  unit_label text not null,
  target_role_id integer references public.labor_roles(role_id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint piecework_activities_org_code_key unique (org_id, code)
);

create index if not exists idx_piecework_activities_org_active
  on public.piecework_activities(org_id, is_active);

drop trigger if exists piecework_activities_set_updated_at on public.piecework_activities;
create trigger piecework_activities_set_updated_at
before update on public.piecework_activities
for each row
execute function public.set_current_timestamp();

alter table public.piecework_activities enable row level security;

drop policy if exists piecework_activities_org_read on public.piecework_activities;
create policy piecework_activities_org_read on public.piecework_activities
  for select using (public.is_org_member(org_id));

drop policy if exists piecework_activities_org_write on public.piecework_activities;
create policy piecework_activities_org_write on public.piecework_activities
  for all using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create table if not exists public.piecework_card_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_card_id integer not null references public.job_cards(job_card_id) on delete cascade,
  old_count integer,
  new_count integer not null check (new_count >= 0),
  reason text,
  adjusted_by uuid not null references auth.users(id),
  adjusted_at timestamptz not null default now()
);

create index if not exists idx_piecework_card_adjustments_card_at
  on public.piecework_card_adjustments(job_card_id, adjusted_at);

alter table public.piecework_card_adjustments enable row level security;

drop policy if exists piecework_card_adjustments_org_read on public.piecework_card_adjustments;
create policy piecework_card_adjustments_org_read on public.piecework_card_adjustments
  for select using (public.is_org_member(org_id));

drop policy if exists piecework_card_adjustments_org_write on public.piecework_card_adjustments;
create policy piecework_card_adjustments_org_write on public.piecework_card_adjustments
  for all using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

alter table public.job_cards
  add column if not exists piecework_activity_id uuid references public.piecework_activities(id) on delete set null,
  add column if not exists cutting_plan_run_id integer references public.orders(order_id) on delete set null,
  add column if not exists material_color_label text,
  add column if not exists expected_count integer check (expected_count is null or expected_count >= 0),
  add column if not exists actual_count integer check (actual_count is null or actual_count >= 0),
  add column if not exists rate_snapshot numeric(10, 2) check (rate_snapshot is null or rate_snapshot >= 0);

create index if not exists idx_job_cards_piecework_activity
  on public.job_cards(piecework_activity_id)
  where piecework_activity_id is not null;

create index if not exists idx_job_cards_cutting_plan_run
  on public.job_cards(cutting_plan_run_id)
  where cutting_plan_run_id is not null;

alter table public.job_work_pool
  add column if not exists cutting_plan_run_id integer references public.orders(order_id) on delete set null,
  add column if not exists piecework_activity_id uuid references public.piecework_activities(id) on delete set null,
  add column if not exists expected_count integer check (expected_count is null or expected_count >= 0),
  add column if not exists material_color_label text;

create index if not exists idx_job_work_pool_piecework_activity
  on public.job_work_pool(piecework_activity_id)
  where piecework_activity_id is not null;

create index if not exists idx_job_work_pool_cutting_plan_run
  on public.job_work_pool(cutting_plan_run_id)
  where cutting_plan_run_id is not null;

alter table public.job_work_pool
  drop constraint if exists job_work_pool_source_check;

alter table public.job_work_pool
  add constraint job_work_pool_source_check
  check (source in ('bol', 'manual', 'cutting_plan'));

alter table public.job_work_pool
  drop constraint if exists job_work_pool_cutting_plan_piecework_fields_check;

alter table public.job_work_pool
  add constraint job_work_pool_cutting_plan_piecework_fields_check
  check (
    source = 'cutting_plan'
    or (
      cutting_plan_run_id is null
      and piecework_activity_id is null
      and expected_count is null
      and material_color_label is null
    )
  );

do $$
declare
  v_org_id uuid;
  v_cut_role_id integer;
  v_edge_role_id integer;
begin
  select id into v_org_id
  from public.organizations
  where lower(name) = lower('QButton')
  limit 1;

  select role_id into v_cut_role_id
  from public.labor_roles
  where btrim(name) = 'Cut and Edge'
  order by role_id
  limit 1;

  select role_id into v_edge_role_id
  from public.labor_roles
  where name = 'Edging'
  order by role_id
  limit 1;

  if v_org_id is null then
    raise exception 'QButton organization not found for piecework seed';
  end if;

  if v_cut_role_id is null then
    raise exception 'Cut and Edge labor role not found for piecework seed';
  end if;

  if v_edge_role_id is null then
    raise exception 'Edging labor role not found for piecework seed';
  end if;

  insert into public.piecework_activities (
    org_id,
    code,
    label,
    default_rate,
    unit_label,
    target_role_id,
    is_active
  )
  values
    (v_org_id, 'cut_pieces', 'Cutting', 6.50, 'piece', v_cut_role_id, true),
    (v_org_id, 'edge_bundles', 'Edging', 4.00, 'bundle', v_edge_role_id, true)
  on conflict (org_id, code) do update
  set
    label = excluded.label,
    default_rate = excluded.default_rate,
    unit_label = excluded.unit_label,
    target_role_id = excluded.target_role_id,
    is_active = excluded.is_active,
    updated_at = now();
end $$;

commit;
