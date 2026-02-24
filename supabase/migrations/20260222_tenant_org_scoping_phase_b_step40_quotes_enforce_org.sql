-- Phase B Step 40: quotes org_id enforcement (single-table baby step).

begin;

alter table public.quotes
  validate constraint quotes_org_id_fkey;

alter table public.quotes
  add constraint quotes_org_id_not_null
  check (org_id is not null) not valid;

alter table public.quotes
  validate constraint quotes_org_id_not_null;

alter table public.quotes
  alter column org_id set not null;

commit;
