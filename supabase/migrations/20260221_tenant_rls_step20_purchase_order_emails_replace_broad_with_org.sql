-- Tenant RLS rollout Step 20 (baby step): purchase_order_emails only.
-- Replace permissive select/insert policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Allow authenticated users to view purchase order emails" on public.purchase_order_emails;
drop policy if exists "Allow authenticated users to insert purchase order emails" on public.purchase_order_emails;

-- Idempotent cleanup for re-runs.
drop policy if exists purchase_order_emails_select_org_member on public.purchase_order_emails;
drop policy if exists purchase_order_emails_insert_org_member on public.purchase_order_emails;

-- Tenant-scoped select (same command coverage as before).
create policy purchase_order_emails_select_org_member
on public.purchase_order_emails
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_emails.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert (same command coverage as before).
create policy purchase_order_emails_insert_org_member
on public.purchase_order_emails
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = purchase_order_emails.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
