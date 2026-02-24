-- Tenant org scoping Step 48 (baby step): supplier_pricelists constraint enforcement.
-- Safe sequence: validate FK -> add/validate NOT NULL check -> set NOT NULL.

begin;

alter table public.supplier_pricelists
  validate constraint supplier_pricelists_org_id_fkey;

alter table public.supplier_pricelists
  add constraint supplier_pricelists_org_id_not_null
  check (org_id is not null) not valid;

alter table public.supplier_pricelists
  validate constraint supplier_pricelists_org_id_not_null;

alter table public.supplier_pricelists
  alter column org_id set not null;

commit;
