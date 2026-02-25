-- Hotfix: allow anon scanner inserts to complete by running summary trigger as function owner.
-- Also propagate org_id explicitly for time_daily_summary upserts.

create or replace function public.update_daily_work_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  work_date date := date(new.event_time at time zone 'UTC');
  first_in timestamptz;
  last_out timestamptz;
  total_work_sec numeric;
  complete_flag boolean;
  dow int;
  unpaid_minutes int;
  is_holiday boolean;
  paid_hours numeric;
  v_org_id uuid;
begin
  v_org_id := coalesce(
    new.org_id,
    (select s.org_id from public.staff s where s.staff_id = new.staff_id limit 1)
  );

  select
    min(case when event_type = 'clock_in'  then event_time end),
    max(case when event_type = 'clock_out' then event_time end)
  into first_in, last_out
  from public.time_clock_events
  where staff_id = new.staff_id
    and org_id = v_org_id
    and date(event_time at time zone 'UTC') = work_date;

  select coalesce(sum(extract(epoch from (next_event_time - event_time))), 0)
  into total_work_sec
  from (
    select
      event_time,
      lead(event_time) over (order by event_time) as next_event_time,
      event_type
    from public.time_clock_events
    where staff_id = new.staff_id
      and org_id = v_org_id
      and date(event_time at time zone 'UTC') = work_date
  ) ev
  where event_type = 'clock_in';

  complete_flag := last_out is not null;

  dow := extract(dow from work_date);
  select exists(select 1 from public.public_holidays where holiday_date = work_date)
    into is_holiday;

  if is_holiday or dow = 0 then
    unpaid_minutes := 30;
  elsif dow between 1 and 4 then
    unpaid_minutes := 30;
  else
    unpaid_minutes := 0;
  end if;

  paid_hours := greatest(((total_work_sec / 60) - unpaid_minutes) / 60.0, 0);

  insert into public.time_daily_summary
    (
      staff_id,
      org_id,
      date_worked,
      first_clock_in,
      last_clock_out,
      unpaid_break_minutes,
      total_hours_worked,
      is_complete
    )
  values
    (
      new.staff_id,
      v_org_id,
      work_date,
      first_in,
      last_out,
      unpaid_minutes,
      paid_hours,
      complete_flag
    )
  on conflict (staff_id, date_worked) do update
  set org_id = excluded.org_id,
      first_clock_in = excluded.first_clock_in,
      last_clock_out = excluded.last_clock_out,
      unpaid_break_minutes = coalesce(public.time_daily_summary.unpaid_break_minutes, excluded.unpaid_break_minutes),
      total_hours_worked = excluded.total_hours_worked,
      is_complete = excluded.is_complete,
      updated_at = now();

  return new;
end;
$function$;
