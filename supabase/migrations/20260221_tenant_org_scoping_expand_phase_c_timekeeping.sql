-- Tenant org scoping expand-only Phase C: timekeeping tables.
-- Safe/additive only: add org_id, set temporary defaults, backfill, add NOT VALID FKs, add indexes.

begin;

do $$
declare
  v_default_org_id uuid;
begin
  -- Prefer Qbutton; fallback to first org if Qbutton name is unavailable.
  select o.id
  into v_default_org_id
  from public.organizations o
  where lower(o.name) = lower('Qbutton')
  limit 1;

  if v_default_org_id is null then
    select o.id into v_default_org_id
    from public.organizations o
    order by o.created_at
    limit 1;
  end if;

  if v_default_org_id is null then
    raise exception 'No organizations row found; cannot backfill org_id defaults for timekeeping tables';
  end if;

  -- 1) Add nullable columns.
  alter table public.time_clock_events add column if not exists org_id uuid;
  alter table public.time_segments add column if not exists org_id uuid;
  alter table public.time_daily_summary add column if not exists org_id uuid;

  -- 2) Set temporary defaults for legacy writes.
  execute format(
    'alter table public.time_clock_events alter column org_id set default %L::uuid',
    v_default_org_id::text
  );
  execute format(
    'alter table public.time_segments alter column org_id set default %L::uuid',
    v_default_org_id::text
  );
  execute format(
    'alter table public.time_daily_summary alter column org_id set default %L::uuid',
    v_default_org_id::text
  );

  -- 3) Backfill from staff.org_id where possible; fallback to default org.
  update public.time_clock_events t
  set org_id = coalesce(s.org_id, v_default_org_id)
  from public.staff s
  where t.org_id is null
    and t.staff_id = s.staff_id;

  update public.time_clock_events
  set org_id = v_default_org_id
  where org_id is null;

  update public.time_segments t
  set org_id = coalesce(s.org_id, v_default_org_id)
  from public.staff s
  where t.org_id is null
    and t.staff_id = s.staff_id;

  update public.time_segments
  set org_id = v_default_org_id
  where org_id is null;

  update public.time_daily_summary t
  set org_id = coalesce(s.org_id, v_default_org_id)
  from public.staff s
  where t.org_id is null
    and t.staff_id = s.staff_id;

  update public.time_daily_summary
  set org_id = v_default_org_id
  where org_id is null;

  -- 4) Add FK constraints as NOT VALID.
  if not exists (
    select 1 from pg_constraint
    where conname = 'time_clock_events_org_id_fkey'
  ) then
    alter table public.time_clock_events
      add constraint time_clock_events_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'time_segments_org_id_fkey'
  ) then
    alter table public.time_segments
      add constraint time_segments_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'time_daily_summary_org_id_fkey'
  ) then
    alter table public.time_daily_summary
      add constraint time_daily_summary_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid;
  end if;
end $$;

-- 5) Indexes for org-scoped queries.
create index if not exists idx_time_clock_events_org_id on public.time_clock_events(org_id);
create index if not exists idx_time_segments_org_id on public.time_segments(org_id);
create index if not exists idx_time_daily_summary_org_id on public.time_daily_summary(org_id);

commit;
