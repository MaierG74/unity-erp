-- Tenant RLS rollout Step 27 (baby step): time_clock_events.
-- Keep anonymous clock-in flow for INSERT only, but tighten authenticated access to org-scoped policies.

begin;

-- Remove legacy/broad policies.
drop policy if exists "Allow anon insert to time_clock_events" on public.time_clock_events;
drop policy if exists "Allow anon read access to time clock events" on public.time_clock_events;
drop policy if exists "Allow anonymous inserts to time_clock_events" on public.time_clock_events;
drop policy if exists "Allow anonymous reads from time_clock_events" on public.time_clock_events;
drop policy if exists "Allow authenticated users to delete time clock events" on public.time_clock_events;
drop policy if exists "Allow authenticated users to update time clock events" on public.time_clock_events;
drop policy if exists "Allow reading time events" on public.time_clock_events;
drop policy if exists "Allow time clock events recording" on public.time_clock_events;

-- Idempotent cleanup for re-runs.
drop policy if exists time_clock_events_select_org_member on public.time_clock_events;
drop policy if exists time_clock_events_insert_org_member on public.time_clock_events;
drop policy if exists time_clock_events_update_org_member on public.time_clock_events;
drop policy if exists time_clock_events_delete_org_member on public.time_clock_events;
drop policy if exists time_clock_events_insert_anon_staff_org on public.time_clock_events;

-- Authenticated users: org-scoped SELECT.
create policy time_clock_events_select_org_member
on public.time_clock_events
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_clock_events.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Authenticated users: org-scoped INSERT.
create policy time_clock_events_insert_org_member
on public.time_clock_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_clock_events.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
  and exists (
    select 1
    from public.staff s
    where s.staff_id = time_clock_events.staff_id
      and s.org_id = time_clock_events.org_id
  )
);

-- Authenticated users: org-scoped UPDATE.
create policy time_clock_events_update_org_member
on public.time_clock_events
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_clock_events.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_clock_events.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
  and exists (
    select 1
    from public.staff s
    where s.staff_id = time_clock_events.staff_id
      and s.org_id = time_clock_events.org_id
  )
);

-- Authenticated users: org-scoped DELETE.
create policy time_clock_events_delete_org_member
on public.time_clock_events
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_clock_events.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Anonymous users: allow INSERT only for rows tied to a real staff record in the same org.
-- This preserves public clock-in while preventing anonymous read/update/delete.
create policy time_clock_events_insert_anon_staff_org
on public.time_clock_events
for insert
to anon
with check (
  exists (
    select 1
    from public.staff s
    where s.staff_id = time_clock_events.staff_id
      and s.org_id = time_clock_events.org_id
  )
);

commit;
