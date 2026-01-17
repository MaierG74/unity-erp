-- Migration: Add categories to overhead cost elements
-- Date: 2026-01-15

-- Create overhead categories table
create table if not exists public.overhead_categories (
  category_id bigserial primary key,
  name text not null unique,
  description text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add category_id to overhead_cost_elements
alter table public.overhead_cost_elements
add column if not exists category_id bigint references public.overhead_categories(category_id) on delete set null;

-- Create index for category lookups
create index if not exists idx_overhead_cost_elements_category
on public.overhead_cost_elements(category_id);

-- Enable RLS on overhead_categories
alter table public.overhead_categories enable row level security;

-- RLS policies for overhead_categories (same pattern as overhead_cost_elements)
create policy "overhead_categories_select" on public.overhead_categories
  for select using (true);

create policy "overhead_categories_insert" on public.overhead_categories
  for insert with check (true);

create policy "overhead_categories_update" on public.overhead_categories
  for update using (true);

create policy "overhead_categories_delete" on public.overhead_categories
  for delete using (true);

-- Add updated_at trigger for overhead_categories
create or replace function public.update_overhead_categories_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_overhead_categories_updated_at on public.overhead_categories;
create trigger trigger_overhead_categories_updated_at
  before update on public.overhead_categories
  for each row execute function public.update_overhead_categories_updated_at();

-- Insert some default categories
insert into public.overhead_categories (name, description, display_order) values
  ('Wrapping', 'Product wrapping and packaging costs', 1),
  ('Finishing', 'Finishing treatments like powder coating, painting', 2),
  ('Assembly', 'Assembly and installation overhead', 3),
  ('Shipping', 'Shipping and handling overhead', 4)
on conflict (name) do nothing;

-- Comment on table
comment on table public.overhead_categories is 'Categories for organizing overhead cost elements (e.g., Wrapping, Finishing)';
comment on column public.overhead_cost_elements.category_id is 'Optional category for grouping overhead elements';
