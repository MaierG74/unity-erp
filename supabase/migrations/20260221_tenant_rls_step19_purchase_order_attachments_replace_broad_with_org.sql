-- Tenant RLS rollout Step 19 (baby step): purchase_order_attachments only.
-- Replace permissive policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Allow all for authenticated" on public.purchase_order_attachments;

-- Idempotent cleanup for re-runs.
drop policy if exists purchase_order_attachments_select_org_member on public.purchase_order_attachments;
drop policy if exists purchase_order_attachments_insert_org_member on public.purchase_order_attachments;
drop policy if exists purchase_order_attachments_update_org_member on public.purchase_order_attachments;
drop policy if exists purchase_order_attachments_delete_org_member on public.purchase_order_attachments;

-- Tenant-scoped select.
create policy purchase_order_attachments_select_org_member
on public.purchase_order_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert.
create policy purchase_order_attachments_insert_org_member
on public.purchase_order_attachments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped update.
create policy purchase_order_attachments_update_org_member
on public.purchase_order_attachments
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped delete.
create policy purchase_order_attachments_delete_org_member
on public.purchase_order_attachments
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_attachments.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
