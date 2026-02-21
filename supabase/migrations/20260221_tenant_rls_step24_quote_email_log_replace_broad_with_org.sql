-- Tenant RLS rollout Step 24 (baby step): quote_email_log only.
-- Replace permissive select/insert policies with org-scoped policies.

begin;

-- Remove old permissive policies.
drop policy if exists "Users can view quote email logs" on public.quote_email_log;
drop policy if exists "Users can insert quote email logs" on public.quote_email_log;

-- Idempotent cleanup for re-runs.
drop policy if exists quote_email_log_select_org_member on public.quote_email_log;
drop policy if exists quote_email_log_insert_org_member on public.quote_email_log;

-- Tenant-scoped select (same command coverage as before).
create policy quote_email_log_select_org_member
on public.quote_email_log
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_email_log.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

-- Tenant-scoped insert (same command coverage as before).
create policy quote_email_log_insert_org_member
on public.quote_email_log
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_email_log.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
