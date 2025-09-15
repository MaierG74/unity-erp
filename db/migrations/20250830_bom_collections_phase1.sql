-- Phase 1: BOM Collections (Apply-only)
-- Adds core tables for reusable BOM collections and provenance on billofmaterials

begin;

-- 1) Collections catalog
create table if not exists public.bom_collections (
  collection_id serial primary key,
  code text unique not null,
  name text not null,
  description text,
  is_phantom boolean not null default true,
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stamp updated_at if helper exists
do $$ begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at' and n.nspname = 'public'
  ) then
    create or replace trigger trg_bom_collections_updated
      before update on public.bom_collections
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.bom_collections enable row level security;
drop policy if exists bom_collections_authenticated_all on public.bom_collections;
create policy bom_collections_authenticated_all on public.bom_collections
  for all to authenticated using (true) with check (true);

-- 2) Collection items
create table if not exists public.bom_collection_items (
  item_id serial primary key,
  collection_id int not null references public.bom_collections(collection_id) on delete cascade,
  component_id int not null references public.components(component_id),
  quantity_required numeric not null,
  supplier_component_id int references public.suppliercomponents(supplier_component_id)
);

-- Helpful indexes for joins/lookups
create index if not exists idx_bom_collection_items_collection on public.bom_collection_items(collection_id);
create index if not exists idx_bom_collection_items_component on public.bom_collection_items(component_id);
create index if not exists idx_bom_collection_items_collection_component on public.bom_collection_items(collection_id, component_id);

alter table public.bom_collection_items enable row level security;
drop policy if exists bom_collection_items_authenticated_all on public.bom_collection_items;
create policy bom_collection_items_authenticated_all on public.bom_collection_items
  for all to authenticated using (true) with check (true);

-- 3) Attachments (for future attach flow) + used for Apply provenance/scaling defaults
create table if not exists public.product_bom_collections (
  product_id int not null references public.products(product_id) on delete cascade,
  collection_id int not null references public.bom_collections(collection_id) on delete cascade,
  pinned_version int,
  scale numeric not null default 1.0,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  primary key (product_id, collection_id)
);

create index if not exists idx_product_bom_collections_collection on public.product_bom_collections(collection_id);
create index if not exists idx_product_bom_collections_product on public.product_bom_collections(product_id);

alter table public.product_bom_collections enable row level security;
drop policy if exists product_bom_collections_authenticated_all on public.product_bom_collections;
create policy product_bom_collections_authenticated_all on public.product_bom_collections
  for all to authenticated using (true) with check (true);

-- 4) Provenance columns on existing BOM rows
alter table if exists public.billofmaterials
  add column if not exists source_collection_id int references public.bom_collections(collection_id),
  add column if not exists source_collection_version int,
  add column if not exists overridden boolean not null default false;

create index if not exists idx_billofmaterials_source_collection on public.billofmaterials(source_collection_id);

commit;

-- (Optional down/rollback notes)
-- drop index if exists idx_billofmaterials_source_collection;
-- alter table public.billofmaterials drop column if exists overridden;
-- alter table public.billofmaterials drop column if exists source_collection_version;
-- alter table public.billofmaterials drop column if exists source_collection_id;
-- drop table if exists public.product_bom_collections;
-- drop table if exists public.bom_collection_items;
-- drop table if exists public.bom_collections;
