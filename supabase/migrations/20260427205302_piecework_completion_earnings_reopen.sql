begin;

create table if not exists public.staff_piecework_earning_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  staff_id integer not null references public.staff(staff_id) on delete restrict,
  item_id integer references public.job_card_items(item_id) on delete set null,
  job_card_id integer not null references public.job_cards(job_card_id) on delete cascade,
  order_id integer references public.orders(order_id) on delete set null,
  completion_date date not null default now()::date,
  job_id integer references public.jobs(job_id) on delete set null,
  product_id integer references public.products(product_id) on delete set null,
  completed_quantity integer not null,
  piece_rate numeric(10, 2) not null check (piece_rate >= 0),
  piece_rate_override numeric(10, 2) check (piece_rate_override is null or piece_rate_override >= 0),
  earned_amount numeric(12, 2) not null,
  source text not null default 'piecework_completion',
  reversal_of uuid references public.staff_piecework_earning_entries(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_piecework_earning_entries_source_check
    check (source in ('piecework_completion', 'piecework_reopen_reversal')),
  constraint staff_piecework_earning_entries_reversal_check
    check (
      (source = 'piecework_reopen_reversal' and reversal_of is not null)
      or
      (source = 'piecework_completion' and reversal_of is null)
    )
);

create index if not exists idx_staff_piecework_earning_entries_card
  on public.staff_piecework_earning_entries(job_card_id, created_at);

create index if not exists idx_staff_piecework_earning_entries_staff_date
  on public.staff_piecework_earning_entries(staff_id, completion_date);

create unique index if not exists idx_staff_piecework_earning_entries_one_reversal
  on public.staff_piecework_earning_entries(reversal_of)
  where reversal_of is not null;

alter table public.staff_piecework_earning_entries enable row level security;

drop policy if exists staff_piecework_earning_entries_org_read on public.staff_piecework_earning_entries;
create policy staff_piecework_earning_entries_org_read on public.staff_piecework_earning_entries
  for select using (public.is_org_member(org_id));

drop policy if exists staff_piecework_earning_entries_org_write on public.staff_piecework_earning_entries;
drop policy if exists staff_piecework_earning_entries_org_insert on public.staff_piecework_earning_entries;
drop policy if exists staff_piecework_earning_entries_org_update on public.staff_piecework_earning_entries;
drop policy if exists staff_piecework_earning_entries_org_delete on public.staff_piecework_earning_entries;

create policy staff_piecework_earning_entries_org_insert on public.staff_piecework_earning_entries
  for insert
  with check (public.is_org_member(org_id));

create policy staff_piecework_earning_entries_org_update on public.staff_piecework_earning_entries
  for update using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy staff_piecework_earning_entries_org_delete on public.staff_piecework_earning_entries
  for delete using (public.is_org_member(org_id));

create or replace view public.staff_piecework_earnings
with (security_invoker = true) as
  select
    jc.staff_id,
    o.org_id,
    jci.item_id,
    jc.job_card_id,
    jc.order_id,
    jc.completion_date,
    jci.job_id,
    jci.product_id,
    jci.completed_quantity,
    jci.piece_rate,
    jci.piece_rate_override,
    jci.completed_quantity::numeric * coalesce(jci.piece_rate_override, jci.piece_rate) as earned_amount
  from public.job_cards jc
  join public.job_card_items jci on jci.job_card_id = jc.job_card_id
  join public.orders o on o.order_id = jc.order_id
  where jc.status = 'completed'
    and jci.piece_rate is not null
    and jci.piece_rate > 0::numeric
    and not exists (
      select 1
      from public.staff_piecework_earning_entries spee
      where spee.job_card_id = jc.job_card_id
    )
  union all
  select
    spee.staff_id,
    spee.org_id,
    spee.item_id,
    spee.job_card_id,
    spee.order_id,
    spee.completion_date,
    spee.job_id,
    spee.product_id,
    spee.completed_quantity,
    spee.piece_rate,
    spee.piece_rate_override,
    spee.earned_amount
  from public.staff_piecework_earning_entries spee;

create or replace function public.insert_staff_piecework_earnings_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.staff_piecework_earning_entries (
    org_id,
    staff_id,
    item_id,
    job_card_id,
    order_id,
    completion_date,
    job_id,
    product_id,
    completed_quantity,
    piece_rate,
    piece_rate_override,
    earned_amount,
    source,
    reversal_of,
    created_by
  )
  values (
    new.org_id,
    new.staff_id,
    new.item_id,
    new.job_card_id,
    new.order_id,
    coalesce(new.completion_date, now()::date),
    new.job_id,
    new.product_id,
    new.completed_quantity,
    new.piece_rate,
    new.piece_rate_override,
    new.earned_amount,
    coalesce(nullif(current_setting('app.piecework_earnings_source', true), ''), 'piecework_completion'),
    nullif(current_setting('app.piecework_reversal_of', true), '')::uuid,
    auth.uid()
  );

  return null;
end;
$$;

drop trigger if exists staff_piecework_earnings_insert on public.staff_piecework_earnings;
create trigger staff_piecework_earnings_insert
instead of insert on public.staff_piecework_earnings
for each row
execute function public.insert_staff_piecework_earnings_entry();

create or replace function public.complete_piecework_assignment(
  p_assignment_id integer,
  p_actual_count integer,
  p_attribution jsonb,
  p_reason text default null,
  p_actual_start timestamptz default null,
  p_actual_end timestamptz default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_assignment record;
  v_card record;
  v_actual_end timestamptz;
  v_actual_start timestamptz;
  v_start_minutes integer;
  v_end_minutes integer;
  v_duration integer;
  v_total_attributed integer;
  v_attribution_count integer;
  v_completion_date date;
begin
  if p_actual_count is null or p_actual_count < 0 then
    raise exception 'Actual count must be zero or greater';
  end if;

  if p_attribution is null or jsonb_typeof(p_attribution) <> 'array' or jsonb_array_length(p_attribution) = 0 then
    raise exception 'Attribution must include at least one staff row';
  end if;

  select
    lpa.assignment_id,
    lpa.job_status,
    lpa.staff_id,
    lpa.order_id,
    lpa.job_instance_id,
    lpa.started_at,
    o.org_id
  into v_assignment
  from public.labor_plan_assignments lpa
  join public.orders o on o.order_id = lpa.order_id
  where lpa.assignment_id = p_assignment_id
  for update of lpa;

  if v_assignment.assignment_id is null then
    raise exception 'Assignment % not found', p_assignment_id;
  end if;

  if not public.is_org_member(v_assignment.org_id) then
    raise exception 'Access denied: not a member of this organisation';
  end if;

  if v_assignment.job_status not in ('issued', 'in_progress', 'on_hold') then
    raise exception 'Cannot complete assignment with status %', v_assignment.job_status;
  end if;

  select
    jc.job_card_id,
    jc.order_id,
    jc.staff_id,
    jc.status,
    jc.piecework_activity_id,
    jc.expected_count,
    jc.actual_count,
    jc.rate_snapshot,
    o.org_id
  into v_card
  from public.job_cards jc
  join public.orders o on o.order_id = jc.order_id
  where jc.job_card_id = public.extract_job_card_id_from_instance(v_assignment.job_instance_id)
  for update of jc;

  if v_card.job_card_id is null then
    raise exception 'No linked job card found for assignment %', p_assignment_id;
  end if;

  if v_card.piecework_activity_id is null then
    raise exception 'Job card % is not a piecework card', v_card.job_card_id;
  end if;

  if v_card.status = 'completed' or v_card.actual_count is not null then
    raise exception 'Job card % is already completed', v_card.job_card_id;
  end if;

  if v_card.rate_snapshot is null then
    raise exception 'Job card % has no piecework rate snapshot', v_card.job_card_id;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_attribution) elem
    where (elem->>'staff_id') is null
      or (elem->>'count') is null
      or (elem->>'count')::integer < 0
  ) then
    raise exception 'Each attribution row requires staff_id and non-negative count';
  end if;

  select coalesce(sum((elem->>'count')::integer), 0), count(*)
  into v_total_attributed, v_attribution_count
  from jsonb_array_elements(p_attribution) elem;

  if v_total_attributed <> p_actual_count then
    raise exception 'Attribution total % does not equal actual count %', v_total_attributed, p_actual_count;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_attribution) elem
    left join public.staff s on s.staff_id = (elem->>'staff_id')::integer
    where s.staff_id is null
      or s.org_id is distinct from v_assignment.org_id
      or coalesce(s.is_active, false) = false
  ) then
    raise exception 'Attribution contains staff outside this organisation or inactive staff';
  end if;

  if p_actual_count is distinct from v_card.expected_count and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required when actual count differs from expected count';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_attribution) elem
    where public.is_job_card_payroll_locked((elem->>'staff_id')::integer, coalesce(p_actual_end, v_now)::date)
  ) then
    raise exception 'Payroll is locked for one or more attributed staff';
  end if;

  update public.assignment_pause_events
  set resumed_at = v_now
  where assignment_id = p_assignment_id
    and resumed_at is null;

  v_actual_start := coalesce(p_actual_start, v_assignment.started_at, v_now);
  v_actual_end := coalesce(p_actual_end, v_now);
  v_completion_date := v_actual_end::date;
  v_start_minutes := extract(hour from v_actual_start at time zone 'Africa/Johannesburg') * 60
                   + extract(minute from v_actual_start at time zone 'Africa/Johannesburg');
  v_end_minutes := extract(hour from v_actual_end at time zone 'Africa/Johannesburg') * 60
                 + extract(minute from v_actual_end at time zone 'Africa/Johannesburg');
  v_duration := public.calculate_working_minutes(v_actual_start, v_actual_end, v_assignment.org_id, p_assignment_id);

  if p_actual_count is distinct from v_card.expected_count then
    insert into public.piecework_card_adjustments (
      org_id,
      job_card_id,
      old_count,
      new_count,
      reason,
      adjusted_by,
      adjusted_at
    )
    values (
      v_assignment.org_id,
      v_card.job_card_id,
      v_card.expected_count,
      p_actual_count,
      p_reason,
      v_actor,
      v_now
    );
  end if;

  perform set_config('app.piecework_earnings_source', 'piecework_completion', true);
  perform set_config('app.piecework_reversal_of', '', true);

  insert into public.staff_piecework_earnings (
    staff_id,
    org_id,
    item_id,
    job_card_id,
    order_id,
    completion_date,
    job_id,
    product_id,
    completed_quantity,
    piece_rate,
    piece_rate_override,
    earned_amount
  )
  select
    (elem->>'staff_id')::integer,
    v_assignment.org_id,
    null::integer,
    v_card.job_card_id,
    v_card.order_id,
    v_completion_date,
    null::integer,
    null::integer,
    (elem->>'count')::integer,
    v_card.rate_snapshot,
    null::numeric,
    ((elem->>'count')::integer * v_card.rate_snapshot)::numeric(12, 2)
  from jsonb_array_elements(p_attribution) elem;

  update public.job_cards
  set status = 'completed',
      completion_date = v_completion_date,
      completed_by_user_id = v_actor,
      completion_type = 'full',
      actual_count = p_actual_count,
      updated_at = v_now
  where job_card_id = v_card.job_card_id;

  update public.labor_plan_assignments
  set job_status = 'completed',
      completed_at = v_now,
      actual_start_minutes = v_start_minutes,
      actual_end_minutes = v_end_minutes,
      actual_duration_minutes = v_duration,
      completion_notes = p_notes,
      updated_at = v_now
  where assignment_id = p_assignment_id;

  return jsonb_build_object(
    'assignment_id', p_assignment_id,
    'job_card_id', v_card.job_card_id,
    'actual_count', p_actual_count,
    'attribution_rows', v_attribution_count,
    'piece_rate', v_card.rate_snapshot,
    'completed_at', v_now
  );
end;
$$;

revoke execute on function public.complete_piecework_assignment(integer, integer, jsonb, text, timestamptz, timestamptz, text) from anon, public;
grant execute on function public.complete_piecework_assignment(integer, integer, jsonb, text, timestamptz, timestamptz, text) to authenticated;

create or replace function public.reopen_piecework_job_card(
  p_job_card_id integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_actor uuid := auth.uid();
  v_card record;
  v_reversal_count integer := 0;
  v_entry record;
begin
  select
    jc.job_card_id,
    jc.order_id,
    jc.staff_id,
    jc.status,
    jc.completion_date,
    jc.piecework_activity_id,
    jc.actual_count,
    jc.expected_count,
    o.org_id
  into v_card
  from public.job_cards jc
  join public.orders o on o.order_id = jc.order_id
  where jc.job_card_id = p_job_card_id
  for update of jc;

  if v_card.job_card_id is null then
    raise exception 'Job card % not found', p_job_card_id;
  end if;

  if not public.is_org_member(v_card.org_id) then
    raise exception 'Access denied: not a member of this organisation';
  end if;

  if v_card.piecework_activity_id is null then
    raise exception 'Job card % is not a piecework card', p_job_card_id;
  end if;

  if v_card.status <> 'completed' then
    raise exception 'Only completed cards can be reopened';
  end if;

  if exists (
    select 1
    from public.staff_piecework_earning_entries spee
    where spee.job_card_id = p_job_card_id
      and spee.source = 'piecework_completion'
      and public.is_job_card_payroll_locked(spee.staff_id, spee.completion_date)
  ) then
    raise exception 'Payroll is locked for one or more attributed staff';
  end if;

  for v_entry in
    select spee.*
    from public.staff_piecework_earning_entries spee
    where spee.job_card_id = p_job_card_id
      and spee.source = 'piecework_completion'
      and not exists (
        select 1
        from public.staff_piecework_earning_entries reversal
        where reversal.reversal_of = spee.id
      )
    order by spee.created_at
  loop
    perform set_config('app.piecework_earnings_source', 'piecework_reopen_reversal', true);
    perform set_config('app.piecework_reversal_of', v_entry.id::text, true);

    insert into public.staff_piecework_earnings (
      staff_id,
      org_id,
      item_id,
      job_card_id,
      order_id,
      completion_date,
      job_id,
      product_id,
      completed_quantity,
      piece_rate,
      piece_rate_override,
      earned_amount
    )
    values (
      v_entry.staff_id,
      v_entry.org_id,
      v_entry.item_id,
      v_entry.job_card_id,
      v_entry.order_id,
      v_now::date,
      v_entry.job_id,
      v_entry.product_id,
      -v_entry.completed_quantity,
      v_entry.piece_rate,
      v_entry.piece_rate_override,
      -v_entry.earned_amount
    );

    v_reversal_count := v_reversal_count + 1;
  end loop;

  insert into public.piecework_card_adjustments (
    org_id,
    job_card_id,
    old_count,
    new_count,
    reason,
    adjusted_by,
    adjusted_at
  )
  values (
    v_card.org_id,
    p_job_card_id,
    v_card.actual_count,
    coalesce(v_card.expected_count, 0),
    coalesce(nullif(btrim(p_reason), ''), 'Reopened completed piecework card; earnings reversed.'),
    v_actor,
    v_now
  );

  update public.job_cards
  set status = 'in_progress',
      completion_date = null,
      completed_by_user_id = null,
      completion_type = null,
      actual_count = null,
      updated_at = v_now
  where job_card_id = p_job_card_id;

  update public.job_card_items
  set status = 'in_progress',
      completion_time = null
  where job_card_id = p_job_card_id
    and status = 'completed';

  update public.labor_plan_assignments
  set job_status = 'in_progress',
      completed_at = null,
      updated_at = v_now
  where job_instance_id like format('%%:card-%s', p_job_card_id)
    and job_status = 'completed';

  return jsonb_build_object(
    'job_card_id', p_job_card_id,
    'reversal_rows', v_reversal_count,
    'reopened_at', v_now
  );
end;
$$;

revoke execute on function public.reopen_piecework_job_card(integer, text) from anon, public;
grant execute on function public.reopen_piecework_job_card(integer, text) to authenticated;

commit;
