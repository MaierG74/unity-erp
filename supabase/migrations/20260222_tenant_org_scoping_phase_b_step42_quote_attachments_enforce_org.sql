-- Phase B Step 42: quote_attachments org_id enforcement (single-table baby step).

begin;

alter table public.quote_attachments
  validate constraint quote_attachments_org_id_fkey;

alter table public.quote_attachments
  add constraint quote_attachments_org_id_not_null
  check (org_id is not null) not valid;

alter table public.quote_attachments
  validate constraint quote_attachments_org_id_not_null;

alter table public.quote_attachments
  alter column org_id set not null;

commit;
