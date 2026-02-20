-- Work schedules: per-org configurable shift windows and breaks per day group
create table public.work_schedules (
  schedule_id   serial primary key,
  org_id        uuid not null default public.current_org_id()
                  references public.organizations(id) on delete cascade,
  day_group     text not null,          -- 'mon-thu' | 'fri' | 'sat-sun'
  start_minutes int not null,           -- minutes from midnight (e.g. 420 = 7:00 AM)
  end_minutes   int not null,           -- e.g. 1020 = 5:00 PM
  breaks        jsonb not null default '[]'::jsonb,
  -- breaks shape: [{ "label": string, "startMinutes": int, "endMinutes": int }]
  display_order int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint work_schedules_org_day_uq unique (org_id, day_group),
  constraint work_schedules_time_check check (
    start_minutes >= 0 and end_minutes <= 1440 and start_minutes < end_minutes
  )
);

-- Index for primary lookup: active schedules per org
create index idx_work_schedules_org_active
  on public.work_schedules (org_id) where is_active = true;

-- RLS
alter table public.work_schedules enable row level security;

create policy work_schedules_select_own_org
  on public.work_schedules for select to authenticated
  using (org_id = public.current_org_id());

create policy work_schedules_insert_own_org
  on public.work_schedules for insert to authenticated
  with check (org_id = public.current_org_id());

create policy work_schedules_update_own_org
  on public.work_schedules for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create policy work_schedules_delete_own_org
  on public.work_schedules for delete to authenticated
  using (org_id = public.current_org_id());

-- Auto-update updated_at
create or replace function public.work_schedules_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger work_schedules_updated_at
  before update on public.work_schedules
  for each row execute function public.work_schedules_set_updated_at();

-- Seed default schedules for every existing org that has none yet
insert into public.work_schedules (org_id, day_group, start_minutes, end_minutes, breaks, display_order)
select o.id, v.day_group, v.start_minutes, v.end_minutes, v.breaks::jsonb, v.display_order
from public.organizations o
cross join (values
  ('mon-thu', 420, 1020,
   '[{"label":"Morning tea","startMinutes":600,"endMinutes":615},{"label":"Lunch","startMinutes":720,"endMinutes":750},{"label":"Afternoon tea","startMinutes":900,"endMinutes":915}]',
   1),
  ('fri', 420, 840, '[]', 2),
  ('sat-sun', 480, 840, '[]', 3)
) as v(day_group, start_minutes, end_minutes, breaks, display_order)
where not exists (
  select 1 from public.work_schedules ws where ws.org_id = o.id
);
