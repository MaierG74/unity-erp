-- Tenant RLS rollout Step 51 (baby step): quote_company_settings only.
-- Enable RLS and add org-scoped authenticated policies.

begin;

alter table public.quote_company_settings enable row level security;

-- Idempotent cleanup for re-runs.
drop policy if exists quote_company_settings_select_org_member on public.quote_company_settings;
drop policy if exists quote_company_settings_insert_org_member on public.quote_company_settings;
drop policy if exists quote_company_settings_update_org_member on public.quote_company_settings;
drop policy if exists quote_company_settings_delete_org_member on public.quote_company_settings;

create policy quote_company_settings_select_org_member
on public.quote_company_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_company_settings.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy quote_company_settings_insert_org_member
on public.quote_company_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_company_settings.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy quote_company_settings_update_org_member
on public.quote_company_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_company_settings.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
)
with check (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_company_settings.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

create policy quote_company_settings_delete_org_member
on public.quote_company_settings
for delete
to authenticated
using (
  exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = quote_company_settings.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until <= now())
  )
);

commit;
