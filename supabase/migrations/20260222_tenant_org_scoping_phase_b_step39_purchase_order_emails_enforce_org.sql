-- Phase B Step 39: purchase_order_emails org_id enforcement (single-table baby step).

begin;

alter table public.purchase_order_emails
  validate constraint purchase_order_emails_org_id_fkey;

alter table public.purchase_order_emails
  add constraint purchase_order_emails_org_id_not_null
  check (org_id is not null) not valid;

alter table public.purchase_order_emails
  validate constraint purchase_order_emails_org_id_not_null;

alter table public.purchase_order_emails
  alter column org_id set not null;

commit;
