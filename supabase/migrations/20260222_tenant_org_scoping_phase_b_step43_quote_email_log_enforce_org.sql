-- Phase B Step 43: quote_email_log org_id enforcement (single-table baby step).

begin;

alter table public.quote_email_log
  validate constraint quote_email_log_org_id_fkey;

alter table public.quote_email_log
  add constraint quote_email_log_org_id_not_null
  check (org_id is not null) not valid;

alter table public.quote_email_log
  validate constraint quote_email_log_org_id_not_null;

alter table public.quote_email_log
  alter column org_id set not null;

commit;
