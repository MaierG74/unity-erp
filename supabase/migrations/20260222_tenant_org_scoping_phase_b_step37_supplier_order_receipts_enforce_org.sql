-- Phase B Step 37: supplier_order_receipts org_id enforcement (single-table baby step).

begin;

alter table public.supplier_order_receipts
  validate constraint supplier_order_receipts_org_id_fkey;

alter table public.supplier_order_receipts
  add constraint supplier_order_receipts_org_id_not_null
  check (org_id is not null) not valid;

alter table public.supplier_order_receipts
  validate constraint supplier_order_receipts_org_id_not_null;

alter table public.supplier_order_receipts
  alter column org_id set not null;

commit;
