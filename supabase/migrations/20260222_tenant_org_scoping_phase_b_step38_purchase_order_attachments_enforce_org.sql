-- Phase B Step 38: purchase_order_attachments org_id enforcement (single-table baby step).

begin;

alter table public.purchase_order_attachments
  validate constraint purchase_order_attachments_org_id_fkey;

alter table public.purchase_order_attachments
  add constraint purchase_order_attachments_org_id_not_null
  check (org_id is not null) not valid;

alter table public.purchase_order_attachments
  validate constraint purchase_order_attachments_org_id_not_null;

alter table public.purchase_order_attachments
  alter column org_id set not null;

commit;
