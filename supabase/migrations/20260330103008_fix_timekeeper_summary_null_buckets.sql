-- Fix Sunday/manual timekeeper inserts that fail when legacy summary writers omit
-- total_work_minutes and the daily-summary trigger derives NULL payroll buckets.
-- This keeps first-event placeholder summaries valid and aligns Sunday rows to
-- the documented "double-time only" bucket split.

create or replace function public.before_insert_or_update_time_daily_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  dow int;
  gross_work_minutes int;
  unpaid_minutes int;
  net_work_minutes int;
begin
  gross_work_minutes := greatest(coalesce(new.total_work_minutes, 0), 0);
  new.total_work_minutes := gross_work_minutes;
  new.total_break_minutes := greatest(coalesce(new.total_break_minutes, 0), 0);
  new.lunch_break_minutes := greatest(coalesce(new.lunch_break_minutes, 0), 0);
  new.other_breaks_minutes := greatest(coalesce(new.other_breaks_minutes, 0), 0);
  new.wage_cents := coalesce(new.wage_cents, 0);

  dow := extract(dow from new.date_worked);
  unpaid_minutes := case when dow between 1 and 4 then 30 else 0 end;
  new.unpaid_break_minutes := coalesce(new.unpaid_break_minutes, unpaid_minutes);

  net_work_minutes := greatest(gross_work_minutes - new.unpaid_break_minutes, 0);

  if net_work_minutes = 0 then
    new.regular_minutes := 0;
    new.ot_minutes := 0;
    new.dt_minutes := 0;
    new.total_hours_worked := 0;
    return new;
  end if;

  if dow = 0 then
    new.regular_minutes := 0;
    new.ot_minutes := 0;
    new.dt_minutes := net_work_minutes;
  else
    new.regular_minutes := least(net_work_minutes, 9 * 60);
    new.ot_minutes := greatest(net_work_minutes - new.regular_minutes, 0);
    new.dt_minutes := 0;
  end if;

  new.total_hours_worked := round(net_work_minutes / 60.0, 2);

  return new;
end;
$function$;

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
  last_event_type text;
  total_work_sec numeric;
  total_break_sec numeric;
  lunch_break_sec numeric;
  complete_flag boolean;
  dow int;
  unpaid_minutes int;
  total_work_minutes int;
  total_break_minutes int;
  lunch_break_minutes int;
  other_break_minutes int;
  paid_hours numeric;
  v_org_id uuid;
begin
  v_org_id := coalesce(
    new.org_id,
    (select s.org_id from public.staff s where s.staff_id = new.staff_id limit 1)
  );

  select
    min(case when event_type = 'clock_in' then event_time end),
    max(case when event_type = 'clock_out' then event_time end)
  into first_in, last_out
  from public.time_clock_events
  where staff_id = new.staff_id
    and org_id = v_org_id
    and date(event_time at time zone 'UTC') = work_date;

  select event_type
  into last_event_type
  from public.time_clock_events
  where staff_id = new.staff_id
    and org_id = v_org_id
    and date(event_time at time zone 'UTC') = work_date
  order by event_time desc, created_at desc
  limit 1;

  select
    coalesce(sum(
      case
        when event_type in ('clock_in', 'break_end') and next_event_time is not null
          then extract(epoch from (next_event_time - event_time))
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when event_type = 'break_start' and next_event_time is not null
          then extract(epoch from (next_event_time - event_time))
        else 0
      end
    ), 0),
    coalesce(sum(
      case
        when event_type = 'break_start'
          and break_type = 'lunch'
          and next_event_time is not null
          then extract(epoch from (next_event_time - event_time))
        else 0
      end
    ), 0)
  into total_work_sec, total_break_sec, lunch_break_sec
  from (
    select
      event_time,
      event_type,
      break_type,
      lead(event_time) over (order by event_time, created_at, id) as next_event_time
    from public.time_clock_events
    where staff_id = new.staff_id
      and org_id = v_org_id
      and date(event_time at time zone 'UTC') = work_date
  ) ev;

  complete_flag := coalesce(last_event_type = 'clock_out', false);

  total_work_minutes := floor(total_work_sec / 60.0)::int;
  total_break_minutes := floor(total_break_sec / 60.0)::int;
  lunch_break_minutes := floor(lunch_break_sec / 60.0)::int;
  other_break_minutes := greatest(total_break_minutes - lunch_break_minutes, 0);

  dow := extract(dow from work_date);
  unpaid_minutes := case when dow between 1 and 4 then 30 else 0 end;
  paid_hours := greatest((total_work_minutes - unpaid_minutes) / 60.0, 0);

  insert into public.time_daily_summary
    (
      staff_id,
      org_id,
      date_worked,
      first_clock_in,
      last_clock_out,
      total_work_minutes,
      total_break_minutes,
      unpaid_break_minutes,
      lunch_break_minutes,
      other_breaks_minutes,
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
      total_work_minutes,
      total_break_minutes,
      unpaid_minutes,
      lunch_break_minutes,
      other_break_minutes,
      paid_hours,
      complete_flag
    )
  on conflict (staff_id, date_worked) do update
  set org_id = excluded.org_id,
      first_clock_in = excluded.first_clock_in,
      last_clock_out = excluded.last_clock_out,
      total_work_minutes = excluded.total_work_minutes,
      total_break_minutes = excluded.total_break_minutes,
      unpaid_break_minutes = excluded.unpaid_break_minutes,
      lunch_break_minutes = excluded.lunch_break_minutes,
      other_breaks_minutes = excluded.other_breaks_minutes,
      total_hours_worked = excluded.total_hours_worked,
      is_complete = excluded.is_complete,
      updated_at = now();

  return new;
end;
$function$;
