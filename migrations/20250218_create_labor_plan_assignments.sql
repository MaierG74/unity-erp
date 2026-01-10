-- Labor planning assignments table to persist schedule decisions
create table if not exists public.labor_plan_assignments (
  assignment_id bigserial primary key,
  job_instance_id text not null,
  order_id integer references public.orders(order_id),
  order_detail_id integer references public.order_details(order_detail_id),
  bol_id integer references public.billoflabour(bol_id),
  job_id integer references public.jobs(job_id),
  staff_id integer references public.staff(staff_id),
  assignment_date date not null,
  start_minutes integer null,
  end_minutes integer null,
  status text not null default 'scheduled' check (status in ('scheduled', 'unscheduled')),
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'piece')),
  rate_id integer null,
  hourly_rate_id integer null,
  piece_rate_id integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labor_plan_assignments_job_date_key unique (job_instance_id, assignment_date),
  constraint labor_plan_assignments_valid_duration check (
    (start_minutes is null and end_minutes is null)
    or (start_minutes is not null and end_minutes is not null and end_minutes > start_minutes)
  )
);

create index if not exists idx_labor_plan_assignments_staff_date on public.labor_plan_assignments (staff_id, assignment_date);
create index if not exists idx_labor_plan_assignments_order on public.labor_plan_assignments (order_id);
