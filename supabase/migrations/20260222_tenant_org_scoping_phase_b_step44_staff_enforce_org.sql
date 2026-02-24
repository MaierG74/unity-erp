-- Phase B Step 44: staff org_id enforcement (single-table baby step).

begin;

alter table public.staff
  validate constraint staff_org_id_fkey;

alter table public.staff
  add constraint staff_org_id_not_null
  check (org_id is not null) not valid;

alter table public.staff
  validate constraint staff_org_id_not_null;

alter table public.staff
  alter column org_id set not null;

commit;
