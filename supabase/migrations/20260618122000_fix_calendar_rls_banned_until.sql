-- Fix: the non_working_days + staff_short_time admin write policies copied an inverted
-- banned_until predicate (banned_until > now() would GRANT writes to a currently-banned admin).
-- Align with the established tenancy convention: active = banned_until IS NULL OR banned_until <= now().
-- Only the INSERT/UPDATE/DELETE (org-admin) policies are affected; SELECT uses is_org_member().

-- non_working_days
drop policy if exists non_working_days_insert_org_admin on public.non_working_days;
create policy non_working_days_insert_org_admin on public.non_working_days
for insert to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = non_working_days.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists non_working_days_update_org_admin on public.non_working_days;
create policy non_working_days_update_org_admin on public.non_working_days
for update to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = non_working_days.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = non_working_days.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists non_working_days_delete_org_admin on public.non_working_days;
create policy non_working_days_delete_org_admin on public.non_working_days
for delete to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = non_working_days.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- staff_short_time
drop policy if exists staff_short_time_insert_org_admin on public.staff_short_time;
create policy staff_short_time_insert_org_admin on public.staff_short_time
for insert to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists staff_short_time_update_org_admin on public.staff_short_time;
create policy staff_short_time_update_org_admin on public.staff_short_time
for update to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

drop policy if exists staff_short_time_delete_org_admin on public.staff_short_time;
create policy staff_short_time_delete_org_admin on public.staff_short_time
for delete to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin') and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);
