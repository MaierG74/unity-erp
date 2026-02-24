-- Phase B Step 41: quote_items org_id enforcement (single-table baby step).

begin;

alter table public.quote_items
  validate constraint quote_items_org_id_fkey;

alter table public.quote_items
  add constraint quote_items_org_id_not_null
  check (org_id is not null) not valid;

alter table public.quote_items
  validate constraint quote_items_org_id_not_null;

alter table public.quote_items
  alter column org_id set not null;

commit;
