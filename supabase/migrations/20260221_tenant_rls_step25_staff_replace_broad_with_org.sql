-- Tenant RLS rollout Step 25 (baby step): staff only.
-- Remove broad/duplicate policies and replace with org-scoped authenticated policies.

begin;

-- Remove old broad and duplicate policies.
drop policy if exists "Allow anon read access to staff" on public.staff;
drop policy if exists "Allow anyone to read staff" on public.staff;
drop policy if exists "Allow authenticated users to read staff" on public.staff;
drop policy if exists "Allow authenticated users to insert staff" on public.staff;
drop policy if exists "Allow authenticated users to update staff" on public.staff;
drop policy if exists "Allow authenticated users to delete staff" on public.staff;
drop policy if exists "Only allow admins to update staff" on public.staff;

-- Idempotent cleanup for re-runs.
drop policy if exists staff_select_org_member on public.staff;
drop policy if exists staff_insert_org_member on public.staff;
drop policy if exists staff_update_org_member on public.staff;
drop policy if exists staff_delete_org_member on public.staff;

-- Tenant-scoped select.
create policy staff_select_org_member
on public.staff
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy staff_insert_org_member
on public.staff
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy staff_update_org_member
on public.staff
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy staff_delete_org_member
on public.staff
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
