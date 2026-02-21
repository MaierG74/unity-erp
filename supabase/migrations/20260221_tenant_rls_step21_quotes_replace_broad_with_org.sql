-- Tenant RLS rollout Step 21 (baby step): quotes only.
-- Replace permissive ALL policy with org-scoped policies.

begin;

-- Remove old permissive policy.
drop policy if exists allow_all_on_quotes on public.quotes;

-- Idempotent cleanup for re-runs.
drop policy if exists quotes_select_org_member on public.quotes;
drop policy if exists quotes_insert_org_member on public.quotes;
drop policy if exists quotes_update_org_member on public.quotes;
drop policy if exists quotes_delete_org_member on public.quotes;

-- Tenant-scoped select.
create policy quotes_select_org_member
on public.quotes
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quotes.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy quotes_insert_org_member
on public.quotes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quotes.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy quotes_update_org_member
on public.quotes
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quotes.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quotes.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy quotes_delete_org_member
on public.quotes
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quotes.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
