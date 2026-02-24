-- Phase B Step 45: staff_hours org_id enforcement (single-table baby step).

begin;

alter table public.staff_hours
  validate constraint staff_hours_org_id_fkey;

alter table public.staff_hours
  add constraint staff_hours_org_id_not_null
  check (org_id is not null) not valid;

alter table public.staff_hours
  validate constraint staff_hours_org_id_not_null;

alter table public.staff_hours
  alter column org_id set not null;

commit;
