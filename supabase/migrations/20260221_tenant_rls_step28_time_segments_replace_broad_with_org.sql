-- Tenant RLS rollout Step 28 (baby step): time_segments only.
-- Remove broad/anon policies and replace with org-scoped authenticated policies.

begin;

-- Remove legacy broad/anon policies.
drop policy if exists "Allow anonymous inserts to time_segments" on public.time_segments;
drop policy if exists "Allow anonymous reads from time_segments" on public.time_segments;
drop policy if exists "Allow authenticated users to select from time_segments" on public.time_segments;
drop policy if exists "Allow authenticated users to insert into time_segments" on public.time_segments;
drop policy if exists "Allow authenticated users to update time_segments" on public.time_segments;
drop policy if exists "Allow authenticated users to delete from time_segments" on public.time_segments;

-- Idempotent cleanup for re-runs.
drop policy if exists time_segments_select_org_member on public.time_segments;
drop policy if exists time_segments_insert_org_member on public.time_segments;
drop policy if exists time_segments_update_org_member on public.time_segments;
drop policy if exists time_segments_delete_org_member on public.time_segments;

-- Authenticated users: org-scoped SELECT.
create policy time_segments_select_org_member
on public.time_segments
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_segments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Authenticated users: org-scoped INSERT.
create policy time_segments_insert_org_member
on public.time_segments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_segments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
  and exists (
    select 1
    from public.staff s
    where s.staff_id = time_segments.staff_id
      and s.org_id = time_segments.org_id
  )
);

-- Authenticated users: org-scoped UPDATE.
create policy time_segments_update_org_member
on public.time_segments
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_segments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_segments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
  and exists (
    select 1
    from public.staff s
    where s.staff_id = time_segments.staff_id
      and s.org_id = time_segments.org_id
  )
);

-- Authenticated users: org-scoped DELETE.
create policy time_segments_delete_org_member
on public.time_segments
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_segments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
