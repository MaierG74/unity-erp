-- Tenant RLS rollout Step 26 (baby step): staff_hours only.
-- Remove broad policies and replace with org-scoped authenticated policies.

begin;

-- Remove old broad policies.
drop policy if exists "Allow authenticated users to read staff_hours" on public.staff_hours;
drop policy if exists "Allow authenticated users to insert staff_hours" on public.staff_hours;
drop policy if exists "Allow authenticated users to update staff_hours" on public.staff_hours;
drop policy if exists "Allow authenticated users to delete staff_hours" on public.staff_hours;

-- Idempotent cleanup for re-runs.
drop policy if exists staff_hours_select_org_member on public.staff_hours;
drop policy if exists staff_hours_insert_org_member on public.staff_hours;
drop policy if exists staff_hours_update_org_member on public.staff_hours;
drop policy if exists staff_hours_delete_org_member on public.staff_hours;

-- Tenant-scoped select.
create policy staff_hours_select_org_member
on public.staff_hours
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_hours.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy staff_hours_insert_org_member
on public.staff_hours
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_hours.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy staff_hours_update_org_member
on public.staff_hours
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_hours.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_hours.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy staff_hours_delete_org_member
on public.staff_hours
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_hours.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
