-- Tenant org scoping Step 50 (baby step): quote_company_settings constraint enforcement.

begin;

alter table public.quote_company_settings
  validate constraint quote_company_settings_org_id_fkey;

alter table public.quote_company_settings
  add constraint quote_company_settings_org_id_not_null
  check (org_id is not null) not valid;

alter table public.quote_company_settings
  validate constraint quote_company_settings_org_id_not_null;

alter table public.quote_company_settings
  alter column org_id set not null;

commit;
