-- Phase C integrity hardening: validate org_id foreign keys on timekeeping tables.

begin;

alter table public.time_clock_events
  validate constraint time_clock_events_org_id_fkey;

alter table public.time_segments
  validate constraint time_segments_org_id_fkey;

alter table public.time_daily_summary
  validate constraint time_daily_summary_org_id_fkey;

commit;
