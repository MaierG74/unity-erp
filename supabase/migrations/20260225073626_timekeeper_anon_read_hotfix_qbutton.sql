-- Hotfix: restore anonymous scanner read access for Timekeeper after tenant RLS hardening.
-- Scope is intentionally narrow: active staff and related clock events in Qbutton only.

begin;

-- Idempotent cleanup.
drop policy if exists staff_select_anon_timekeeper_qbutton on public.staff;
drop policy if exists time_clock_events_select_anon_timekeeper_qbutton on public.time_clock_events;

-- Allow anon scanner app to list active staff for Qbutton only.
create policy staff_select_anon_timekeeper_qbutton
on public.staff
for select
to anon
using (
  is_active = true
  and exists (
    select 1
    from public.organizations o
    where o.id = staff.org_id
      and lower(o.name) = lower('Qbutton')
  )
);

-- Allow anon scanner app to read latest clock events for active Qbutton staff only.
create policy time_clock_events_select_anon_timekeeper_qbutton
on public.time_clock_events
for select
to anon
using (
  exists (
    select 1
    from public.staff s
    join public.organizations o on o.id = s.org_id
    where s.staff_id = time_clock_events.staff_id
      and s.org_id = time_clock_events.org_id
      and s.is_active = true
      and lower(o.name) = lower('Qbutton')
  )
);

commit;
