create table if not exists public.staff_short_time (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id),
  staff_id int null references public.staff(staff_id),
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_short_time_range_chk check (end_date >= start_date)
);

create index if not exists idx_staff_short_time_org_staff_start_end
  on public.staff_short_time (org_id, staff_id, start_date, end_date);

drop trigger if exists staff_short_time_set_updated_at on public.staff_short_time;
create trigger staff_short_time_set_updated_at
before update on public.staff_short_time
for each row execute function public.set_current_timestamp();

comment on table public.staff_short_time is
  'Payroll-inert short-time ranges for absence reporting. A null staff_id applies to all staff in the organization for the range.';

alter table public.staff_short_time enable row level security;

revoke all on table public.staff_short_time from anon;
grant select, insert, update, delete on table public.staff_short_time to authenticated;
revoke all on sequence public.staff_short_time_id_seq from anon;
grant usage, select on sequence public.staff_short_time_id_seq to authenticated;

drop policy if exists staff_short_time_select_org_member on public.staff_short_time;
drop policy if exists staff_short_time_insert_org_admin on public.staff_short_time;
drop policy if exists staff_short_time_update_org_admin on public.staff_short_time;
drop policy if exists staff_short_time_delete_org_admin on public.staff_short_time;

create policy staff_short_time_select_org_member
on public.staff_short_time
for select
to authenticated
using (public.is_org_member(org_id));

create policy staff_short_time_insert_org_admin
on public.staff_short_time
for insert
to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin')
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  )
);

create policy staff_short_time_update_org_admin
on public.staff_short_time
for update
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin')
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin')
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  )
);

create policy staff_short_time_delete_org_admin
on public.staff_short_time
for delete
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.organization_members m
    where m.user_id = auth.uid()
      and m.org_id = staff_short_time.org_id
      and m.role in ('owner', 'admin')
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  )
);

drop function public.staff_absence_report(date, date, int[], text, text);

create function public.staff_absence_report(
  p_start date,
  p_end date,
  p_staff_ids int[] default null,
  p_staff_scope text default 'active',
  p_employment_type text default null
) returns table (
  staff_id int,
  name text,
  employment_type text,
  working_days int,
  days_present int,
  days_absent int,
  absence_rate numeric,
  total_hours numeric,
  public_holidays_count int,
  closure_days_count int,
  worked_holiday_dates date[],
  incomplete_timecard_dates date[],
  short_time_off_dates date[],
  short_time_worked_dates date[],
  absent_dates date[],
  bradford_factor int,
  has_missing_hire_date boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_missing_year int;
begin
  if p_start is null or p_end is null then
    raise exception 'absence report start and end dates are required';
  end if;

  if p_start > p_end then
    raise exception 'absence report start date must be on or before end date';
  end if;

  if p_staff_scope not in ('active', 'all', 'inactive') then
    raise exception 'invalid staff scope %', p_staff_scope;
  end if;

  if p_employment_type is not null
     and p_employment_type not in ('monthly', 'weekly', 'hourly', 'piecework', 'casual') then
    raise exception 'invalid employment type %', p_employment_type;
  end if;

  with staff_scope_orgs as (
    select distinct s.org_id
    from public.staff s
    where (
        (p_staff_ids is not null and s.staff_id = any(p_staff_ids))
        or (
          p_staff_ids is null
          and (
            p_staff_scope = 'all'
            or (
              p_staff_scope = 'active'
              and coalesce(s.is_active, false) = true
              and coalesce(s.current_staff, false) = true
            )
            or (
              p_staff_scope = 'inactive'
              and not (
                coalesce(s.is_active, false) = true
                and coalesce(s.current_staff, false) = true
              )
            )
          )
        )
      )
      and (p_employment_type is null or s.employment_type = p_employment_type)
  ),
  report_years as (
    select y.report_year::int as report_year
    from pg_catalog.generate_series(
      extract(year from p_start)::int,
      extract(year from p_end)::int
    ) as y(report_year)
  ),
  missing_calendar_years as (
    select ry.report_year
    from staff_scope_orgs sso
    cross join report_years ry
    where not exists (
      select 1
      from public.non_working_days nwd
      where nwd.org_id = sso.org_id
        and nwd.kind = 'public_holiday'
        and nwd.day_date >= pg_catalog.make_date(ry.report_year, 1, 1)
        and nwd.day_date < pg_catalog.make_date(ry.report_year + 1, 1, 1)
    )
    order by ry.report_year
    limit 1
  )
  select mcy.report_year
  into v_missing_year
  from missing_calendar_years mcy;

  if v_missing_year is not null then
    raise exception 'absence report calendar not seeded for year %', v_missing_year;
  end if;

  return query
  with staff_scope as (
    select
      s.staff_id,
      s.org_id,
      s.hire_date,
      s.employment_type,
      coalesce(
        nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), ''),
        s.staff_id::text
      )::text as staff_name,
      (s.hire_date is null) as has_missing_hire_date
    from public.staff s
    where (
        (p_staff_ids is not null and s.staff_id = any(p_staff_ids))
        or (
          p_staff_ids is null
          and (
            p_staff_scope = 'all'
            or (
              p_staff_scope = 'active'
              and coalesce(s.is_active, false) = true
              and coalesce(s.current_staff, false) = true
            )
            or (
              p_staff_scope = 'inactive'
              and not (
                coalesce(s.is_active, false) = true
                and coalesce(s.current_staff, false) = true
              )
            )
          )
        )
      )
      and (p_employment_type is null or s.employment_type = p_employment_type)
  ),
  calendar as (
    select gs.day_value::date as day_date
    from pg_catalog.generate_series(p_start, p_end, '1 day'::interval) as gs(day_value)
    where extract(isodow from gs.day_value)::int between 1 and 5
  ),
  effective_calendar as (
    select
      ss.staff_id,
      ss.org_id,
      c.day_date
    from staff_scope ss
    cross join calendar c
    where ss.hire_date is not null
      and c.day_date >= ss.hire_date
  ),
  non_working_exclusions as (
    select
      ec.staff_id,
      count(*) filter (where nwd.kind in ('public_holiday', 'observed_holiday'))::int as public_holidays_count,
      count(*) filter (where nwd.kind = 'company_closure')::int as closure_days_count
    from effective_calendar ec
    join public.non_working_days nwd
      on nwd.org_id = ec.org_id
     and nwd.day_date = ec.day_date
    group by ec.staff_id
  ),
  working_days_base as (
    select
      ec.staff_id,
      ec.org_id,
      ec.day_date
    from effective_calendar ec
    where not exists (
      select 1
      from public.non_working_days nwd
      where nwd.org_id = ec.org_id
        and nwd.day_date = ec.day_date
    )
  ),
  working_days_seq as (
    select
      wdb.staff_id,
      wdb.org_id,
      wdb.day_date,
      row_number() over (partition by wdb.staff_id order by wdb.day_date)::int as workday_seq
    from working_days_base wdb
  ),
  short_time_ranges as (
    select
      ss.staff_id,
      ss.org_id,
      st.start_date,
      st.end_date
    from staff_scope ss
    join public.staff_short_time st
      on st.org_id = ss.org_id
     and (st.staff_id = ss.staff_id or st.staff_id is null)
    where st.start_date <= p_end
      and st.end_date >= p_start
  ),
  short_time_workdays as (
    select distinct
      wds.staff_id,
      wds.org_id,
      wds.day_date
    from working_days_seq wds
    join short_time_ranges str
      on str.staff_id = wds.staff_id
     and str.org_id = wds.org_id
     and wds.day_date between str.start_date and str.end_date
  ),
  working_day_totals as (
    select
      wds.staff_id,
      count(*)::int as working_days
    from working_days_seq wds
    group by wds.staff_id
  ),
  workday_summaries as (
    select
      wds.staff_id,
      wds.org_id,
      wds.day_date,
      wds.workday_seq,
      tds.staff_id as summary_staff_id,
      tds.total_hours_worked,
      tds.is_complete,
      (stw.staff_id is not null) as is_short_time
    from working_days_seq wds
    left join public.time_daily_summary tds
      on tds.org_id = wds.org_id
     and tds.staff_id = wds.staff_id
     and tds.date_worked = wds.day_date
    left join short_time_workdays stw
      on stw.staff_id = wds.staff_id
     and stw.org_id = wds.org_id
     and stw.day_date = wds.day_date
  ),
  present_totals as (
    select
      ws.staff_id,
      count(*)::int as days_present,
      coalesce(sum(ws.total_hours_worked), 0)::numeric as total_hours
    from workday_summaries ws
    where coalesce(ws.total_hours_worked, 0) > 0
      and ws.is_complete is true
    group by ws.staff_id
  ),
  incomplete as (
    select
      tds.staff_id,
      array_agg(distinct tds.date_worked order by tds.date_worked)::date[] as incomplete_timecard_dates
    from public.time_daily_summary tds
    join staff_scope ss
      on ss.staff_id = tds.staff_id
     and ss.org_id = tds.org_id
    where tds.date_worked between p_start and p_end
      and coalesce(tds.is_complete, false) = false
    group by tds.staff_id
  ),
  short_time_off as (
    select
      ws.staff_id,
      array_agg(ws.day_date order by ws.day_date)::date[] as short_time_off_dates
    from workday_summaries ws
    where ws.is_short_time = true
      and not (
        coalesce(ws.total_hours_worked, 0) > 0
        and ws.is_complete is true
      )
      and not (
        ws.summary_staff_id is not null
        and coalesce(ws.is_complete, false) = false
      )
    group by ws.staff_id
  ),
  short_time_worked as (
    select
      ws.staff_id,
      array_agg(ws.day_date order by ws.day_date)::date[] as short_time_worked_dates
    from workday_summaries ws
    where ws.is_short_time = true
      and coalesce(ws.total_hours_worked, 0) > 0
      and ws.is_complete is true
    group by ws.staff_id
  ),
  absent_workdays as (
    select
      ws.staff_id,
      ws.day_date,
      ws.workday_seq
    from workday_summaries ws
    where not (
        coalesce(ws.total_hours_worked, 0) > 0
        and ws.is_complete is true
      )
      and not (
        ws.summary_staff_id is not null
        and coalesce(ws.is_complete, false) = false
      )
      and coalesce(ws.is_short_time, false) = false
  ),
  absent_arrays as (
    select
      aw.staff_id,
      count(*)::int as days_absent,
      array_agg(aw.day_date order by aw.day_date)::date[] as absent_dates
    from absent_workdays aw
    group by aw.staff_id
  ),
  absent_with_lag as (
    select
      aw.staff_id,
      aw.workday_seq,
      lag(aw.workday_seq) over (partition by aw.staff_id order by aw.workday_seq) as previous_workday_seq
    from absent_workdays aw
  ),
  bradford as (
    select
      awl.staff_id,
      (
        count(*) filter (
          where awl.previous_workday_seq is null
             or awl.workday_seq <> awl.previous_workday_seq + 1
        )
        * count(*) filter (
          where awl.previous_workday_seq is null
             or awl.workday_seq <> awl.previous_workday_seq + 1
        )
        * count(*)
      )::int as bradford_factor
    from absent_with_lag awl
    group by awl.staff_id
  ),
  worked_holidays as (
    select
      tds.staff_id,
      array_agg(distinct tds.date_worked order by tds.date_worked)::date[] as worked_holiday_dates
    from public.time_daily_summary tds
    join staff_scope ss
      on ss.staff_id = tds.staff_id
     and ss.org_id = tds.org_id
    join public.non_working_days nwd
      on nwd.org_id = ss.org_id
     and nwd.day_date = tds.date_worked
     and nwd.kind in ('public_holiday', 'observed_holiday')
    where tds.date_worked between p_start and p_end
      and coalesce(tds.total_hours_worked, 0) > 0
    group by tds.staff_id
  )
  select
    ss.staff_id::int as staff_id,
    ss.staff_name::text as name,
    ss.employment_type::text as employment_type,
    case
      when ss.has_missing_hire_date then null
      else coalesce(wdt.working_days, 0)
    end::int as working_days,
    case
      when ss.has_missing_hire_date then null
      else coalesce(pt.days_present, 0)
    end::int as days_present,
    case
      when ss.has_missing_hire_date then null
      else greatest(coalesce(aa.days_absent, 0), 0)
    end::int as days_absent,
    case
      when ss.has_missing_hire_date then null
      when coalesce(wdt.working_days, 0) = 0 then 0::numeric
      else round((greatest(coalesce(aa.days_absent, 0), 0)::numeric / wdt.working_days::numeric) * 100, 2)
    end as absence_rate,
    case
      when ss.has_missing_hire_date then null
      else coalesce(pt.total_hours, 0)
    end::numeric as total_hours,
    case
      when ss.has_missing_hire_date then null
      else coalesce(nwe.public_holidays_count, 0)
    end::int as public_holidays_count,
    case
      when ss.has_missing_hire_date then null
      else coalesce(nwe.closure_days_count, 0)
    end::int as closure_days_count,
    coalesce(wh.worked_holiday_dates, array[]::date[]) as worked_holiday_dates,
    coalesce(inc.incomplete_timecard_dates, array[]::date[]) as incomplete_timecard_dates,
    coalesce(sto.short_time_off_dates, array[]::date[]) as short_time_off_dates,
    coalesce(stw.short_time_worked_dates, array[]::date[]) as short_time_worked_dates,
    case
      when ss.has_missing_hire_date then array[]::date[]
      else coalesce(aa.absent_dates, array[]::date[])
    end as absent_dates,
    case
      when ss.has_missing_hire_date then null
      else coalesce(bf.bradford_factor, 0)
    end::int as bradford_factor,
    ss.has_missing_hire_date as has_missing_hire_date
  from staff_scope ss
  left join working_day_totals wdt on wdt.staff_id = ss.staff_id
  left join present_totals pt on pt.staff_id = ss.staff_id
  left join non_working_exclusions nwe on nwe.staff_id = ss.staff_id
  left join worked_holidays wh on wh.staff_id = ss.staff_id
  left join incomplete inc on inc.staff_id = ss.staff_id
  left join short_time_off sto on sto.staff_id = ss.staff_id
  left join short_time_worked stw on stw.staff_id = ss.staff_id
  left join absent_arrays aa on aa.staff_id = ss.staff_id
  left join bradford bf on bf.staff_id = ss.staff_id
  order by ss.staff_name, ss.staff_id;
end;
$function$;

revoke all on function public.staff_absence_report(date, date, int[], text, text) from public;
revoke execute on function public.staff_absence_report(date, date, int[], text, text) from anon;
grant execute on function public.staff_absence_report(date, date, int[], text, text) to authenticated;

comment on function public.staff_absence_report(date, date, int[], text, text) is
  'Absence report RPC. Reads public.non_working_days and public.staff_short_time, not public.public_holidays, so seeded absence-report holidays and short-time classifications remain payroll-inert.';

notify pgrst, 'reload schema';
