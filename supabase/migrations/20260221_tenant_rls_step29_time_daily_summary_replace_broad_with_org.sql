-- Tenant RLS rollout Step 29 (baby step): time_daily_summary only.
-- Remove broad/anon policies and replace with org-scoped authenticated policies.

begin;

-- Remove legacy broad/anon policies.
drop policy if exists "Allow anonymous inserts to time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow anonymous reads from time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow anonymous updates to time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to delete from time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to insert into time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to insert time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to select from time_daily_summary" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to select their own time_daily_summar" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to update their own time_daily_summar" on public.time_daily_summary;
drop policy if exists "Allow authenticated users to update time_daily_summary" on public.time_daily_summary;

-- Idempotent cleanup for re-runs.
drop policy if exists time_daily_summary_select_org_member on public.time_daily_summary;
drop policy if exists time_daily_summary_insert_org_member on public.time_daily_summary;
drop policy if exists time_daily_summary_update_org_member on public.time_daily_summary;
drop policy if exists time_daily_summary_delete_org_member on public.time_daily_summary;

-- Authenticated users: org-scoped SELECT.
create policy time_daily_summary_select_org_member
on public.time_daily_summary
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_daily_summary.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Authenticated users: org-scoped INSERT.
create policy time_daily_summary_insert_org_member
on public.time_daily_summary
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_daily_summary.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
  and exists (
    select 1
    from public.staff s
    where s.staff_id = time_daily_summary.staff_id
      and s.org_id = time_daily_summary.org_id
  )
);

-- Authenticated users: org-scoped UPDATE.
create policy time_daily_summary_update_org_member
on public.time_daily_summary
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_daily_summary.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_daily_summary.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
  and exists (
    select 1
    from public.staff s
    where s.staff_id = time_daily_summary.staff_id
      and s.org_id = time_daily_summary.org_id
  )
);

-- Authenticated users: org-scoped DELETE.
create policy time_daily_summary_delete_org_member
on public.time_daily_summary
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = time_daily_summary.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
