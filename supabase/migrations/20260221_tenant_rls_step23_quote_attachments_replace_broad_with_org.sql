-- Tenant RLS rollout Step 23 (baby step): quote_attachments only.
-- Replace permissive ALL policy with org-scoped policies.

begin;

-- Remove old permissive policy.
drop policy if exists allow_all_on_quote_attachments on public.quote_attachments;

-- Idempotent cleanup for re-runs.
drop policy if exists quote_attachments_select_org_member on public.quote_attachments;
drop policy if exists quote_attachments_insert_org_member on public.quote_attachments;
drop policy if exists quote_attachments_update_org_member on public.quote_attachments;
drop policy if exists quote_attachments_delete_org_member on public.quote_attachments;

-- Tenant-scoped select.
create policy quote_attachments_select_org_member
on public.quote_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy quote_attachments_insert_org_member
on public.quote_attachments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy quote_attachments_update_org_member
on public.quote_attachments
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy quote_attachments_delete_org_member
on public.quote_attachments
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
