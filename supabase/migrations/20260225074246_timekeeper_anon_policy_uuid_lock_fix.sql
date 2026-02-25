-- Hotfix follow-up: remove organizations-table dependency from anon policies.
-- Anon role cannot read organizations under RLS, causing policy checks to fail.

begin;

drop policy if exists staff_select_anon_timekeeper_qbutton on public.staff;
drop policy if exists time_clock_events_select_anon_timekeeper_qbutton on public.time_clock_events;
drop policy if exists time_clock_events_insert_anon_staff_org on public.time_clock_events;

create policy staff_select_anon_timekeeper_qbutton
on public.staff
for select
to anon
using (
  is_active = true
  and org_id = '99183187-da8e-4ce1-b28a-d08cc70cd7d4'::uuid
);

create policy time_clock_events_select_anon_timekeeper_qbutton
on public.time_clock_events
for select
to anon
using (
  exists (
    select 1
    from public.staff s
    where s.staff_id = time_clock_events.staff_id
      and s.is_active = true
      and s.org_id = '99183187-da8e-4ce1-b28a-d08cc70cd7d4'::uuid
      and (
        time_clock_events.org_id is null
        or time_clock_events.org_id = s.org_id
      )
  )
);

create policy time_clock_events_insert_anon_staff_org
on public.time_clock_events
for insert
to anon
with check (
  exists (
    select 1
    from public.staff s
    where s.staff_id = time_clock_events.staff_id
      and s.is_active = true
      and s.org_id = '99183187-da8e-4ce1-b28a-d08cc70cd7d4'::uuid
      and (
        time_clock_events.org_id is null
        or time_clock_events.org_id = s.org_id
      )
  )
);

commit;
