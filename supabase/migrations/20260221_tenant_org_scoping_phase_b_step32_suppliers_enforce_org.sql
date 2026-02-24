-- Phase B Step 32: suppliers org_id enforcement (single-table baby step).

begin;

alter table public.suppliers
  validate constraint suppliers_org_id_fkey;

alter table public.suppliers
  add constraint suppliers_org_id_not_null
  check (org_id is not null) not valid;

alter table public.suppliers
  validate constraint suppliers_org_id_not_null;

alter table public.suppliers
  alter column org_id set not null;

commit;
