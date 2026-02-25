-- Hotfix: make anon time clock insert policy compatible with scanner payloads.
-- Scanner inserts without org_id in payload; policy must validate by staff membership,
-- while still constraining inserts to active Qbutton staff.

begin;

drop policy if exists time_clock_events_insert_anon_staff_org on public.time_clock_events;

create policy time_clock_events_insert_anon_staff_org
on public.time_clock_events
for insert
to anon
with check (
  exists (
    select 1
    from public.staff s
    join public.organizations o on o.id = s.org_id
    where s.staff_id = time_clock_events.staff_id
      and s.is_active = true
      and lower(o.name) = lower('Qbutton')
      and (
        time_clock_events.org_id is null
        or time_clock_events.org_id = s.org_id
      )
  )
);

commit;
