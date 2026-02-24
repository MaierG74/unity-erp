-- Phase B Step 35: suppliercomponents org_id enforcement (single-table baby step).

begin;

alter table public.suppliercomponents
  validate constraint suppliercomponents_org_id_fkey;

alter table public.suppliercomponents
  add constraint suppliercomponents_org_id_not_null
  check (org_id is not null) not valid;

alter table public.suppliercomponents
  validate constraint suppliercomponents_org_id_not_null;

alter table public.suppliercomponents
  alter column org_id set not null;

commit;
