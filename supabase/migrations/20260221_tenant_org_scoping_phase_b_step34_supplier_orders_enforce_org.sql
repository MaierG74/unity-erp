-- Phase B Step 34: supplier_orders org_id enforcement (single-table baby step).

begin;

alter table public.supplier_orders
  validate constraint supplier_orders_org_id_fkey;

alter table public.supplier_orders
  add constraint supplier_orders_org_id_not_null
  check (org_id is not null) not valid;

alter table public.supplier_orders
  validate constraint supplier_orders_org_id_not_null;

alter table public.supplier_orders
  alter column org_id set not null;

commit;
