-- Migration: Overhead Cost Elements
-- Created: 2026-01-13
-- Description: Tables for managing overhead/indirect costs (wrapping, powder coating, etc.)
--              that can be linked to products and included in costing calculations.

begin;

-- =============================================================================
-- Table 1: overhead_cost_elements (central definitions)
-- =============================================================================
-- Stores reusable overhead cost definitions that can be assigned to products.
-- Supports both fixed amounts (R20 for wrapping) and percentage-based costs
-- (5% of materials for admin overhead).

create table if not exists public.overhead_cost_elements (
  element_id bigserial primary key,
  code text unique not null,
  name text not null,
  description text,
  cost_type text not null default 'fixed' check (cost_type in ('fixed', 'percentage')),
  default_value numeric(12,4) not null default 0,
  percentage_basis text check (percentage_basis in ('materials', 'labor', 'total')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Ensure percentage_basis is set when cost_type is 'percentage'
  constraint overhead_percentage_basis_check check (
    cost_type = 'fixed' or percentage_basis is not null
  )
);

comment on table public.overhead_cost_elements is 'Central definitions for overhead/indirect costs';
comment on column public.overhead_cost_elements.cost_type is 'fixed = flat amount, percentage = % of basis';
comment on column public.overhead_cost_elements.default_value is 'Default value (amount for fixed, % for percentage)';
comment on column public.overhead_cost_elements.percentage_basis is 'For percentage type: materials, labor, or total';

-- =============================================================================
-- Table 2: product_overhead_costs (links elements to products)
-- =============================================================================
-- Junction table linking overhead cost elements to specific products.
-- Allows quantity multiplier and optional value override per product.

create table if not exists public.product_overhead_costs (
  id bigserial primary key,
  product_id integer not null references public.products(product_id) on delete cascade,
  element_id bigint not null references public.overhead_cost_elements(element_id) on delete cascade,
  quantity numeric(10,4) not null default 1,
  override_value numeric(12,4),  -- NULL = use element's default_value
  created_at timestamptz not null default now(),

  unique(product_id, element_id)
);

comment on table public.product_overhead_costs is 'Links overhead cost elements to products';
comment on column public.product_overhead_costs.quantity is 'Multiplier for the cost (e.g., 2 = double the cost)';
comment on column public.product_overhead_costs.override_value is 'Product-specific override, NULL uses element default';

-- =============================================================================
-- Indexes
-- =============================================================================

create index if not exists idx_overhead_elements_active
  on public.overhead_cost_elements(is_active)
  where is_active = true;

create index if not exists idx_overhead_elements_code
  on public.overhead_cost_elements(code);

create index if not exists idx_product_overhead_product
  on public.product_overhead_costs(product_id);

create index if not exists idx_product_overhead_element
  on public.product_overhead_costs(element_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.overhead_cost_elements enable row level security;

drop policy if exists "overhead_elements_select" on public.overhead_cost_elements;
create policy "overhead_elements_select"
  on public.overhead_cost_elements for select
  to authenticated
  using (true);

drop policy if exists "overhead_elements_insert" on public.overhead_cost_elements;
create policy "overhead_elements_insert"
  on public.overhead_cost_elements for insert
  to authenticated
  with check (true);

drop policy if exists "overhead_elements_update" on public.overhead_cost_elements;
create policy "overhead_elements_update"
  on public.overhead_cost_elements for update
  to authenticated
  using (true);

drop policy if exists "overhead_elements_delete" on public.overhead_cost_elements;
create policy "overhead_elements_delete"
  on public.overhead_cost_elements for delete
  to authenticated
  using (true);

alter table public.product_overhead_costs enable row level security;

drop policy if exists "product_overhead_select" on public.product_overhead_costs;
create policy "product_overhead_select"
  on public.product_overhead_costs for select
  to authenticated
  using (true);

drop policy if exists "product_overhead_insert" on public.product_overhead_costs;
create policy "product_overhead_insert"
  on public.product_overhead_costs for insert
  to authenticated
  with check (true);

drop policy if exists "product_overhead_update" on public.product_overhead_costs;
create policy "product_overhead_update"
  on public.product_overhead_costs for update
  to authenticated
  using (true);

drop policy if exists "product_overhead_delete" on public.product_overhead_costs;
create policy "product_overhead_delete"
  on public.product_overhead_costs for delete
  to authenticated
  using (true);

-- =============================================================================
-- Trigger: updated_at
-- =============================================================================

drop trigger if exists overhead_elements_set_updated_at on public.overhead_cost_elements;
create trigger overhead_elements_set_updated_at
  before update on public.overhead_cost_elements
  for each row
  execute function public.set_current_timestamp();

commit;
