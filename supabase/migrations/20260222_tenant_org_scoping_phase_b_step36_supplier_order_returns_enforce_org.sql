-- Phase B Step 36: supplier_order_returns org_id enforcement (single-table baby step).

begin;

alter table public.supplier_order_returns
  validate constraint supplier_order_returns_org_id_fkey;

alter table public.supplier_order_returns
  add constraint supplier_order_returns_org_id_not_null
  check (org_id is not null) not valid;

alter table public.supplier_order_returns
  validate constraint supplier_order_returns_org_id_not_null;

alter table public.supplier_order_returns
  alter column org_id set not null;

commit;
