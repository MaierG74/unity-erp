-- Phase C enforcement: set org_id NOT NULL on timekeeping tables.
-- Safe sequence: add check constraints NOT VALID, validate, then set NOT NULL.

begin;

alter table public.time_clock_events
  add constraint time_clock_events_org_id_not_null
  check (org_id is not null) not valid;
alter table public.time_clock_events
  validate constraint time_clock_events_org_id_not_null;
alter table public.time_clock_events
  alter column org_id set not null;

alter table public.time_segments
  add constraint time_segments_org_id_not_null
  check (org_id is not null) not valid;
alter table public.time_segments
  validate constraint time_segments_org_id_not_null;
alter table public.time_segments
  alter column org_id set not null;

alter table public.time_daily_summary
  add constraint time_daily_summary_org_id_not_null
  check (org_id is not null) not valid;
alter table public.time_daily_summary
  validate constraint time_daily_summary_org_id_not_null;
alter table public.time_daily_summary
  alter column org_id set not null;

commit;
