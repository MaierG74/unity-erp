begin;

-- ============================================================
-- 1. product_price_lists — named price lists per org
-- ============================================================
create table if not exists public.product_price_lists (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists product_price_lists_org_id_idx
  on public.product_price_lists(org_id);

alter table public.product_price_lists enable row level security;

-- RLS policies
drop policy if exists product_price_lists_select on public.product_price_lists;
create policy product_price_lists_select on public.product_price_lists
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_price_lists.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_price_lists_insert on public.product_price_lists;
create policy product_price_lists_insert on public.product_price_lists
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_price_lists.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_price_lists_update on public.product_price_lists;
create policy product_price_lists_update on public.product_price_lists
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_price_lists.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

-- ============================================================
-- 2. product_prices — per-product pricing within a list
-- ============================================================
create table if not exists public.product_prices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  product_id    integer not null references public.products(product_id) on delete cascade,
  price_list_id uuid not null references public.product_price_lists(id) on delete cascade,
  markup_type   text not null check (markup_type in ('percentage', 'fixed')),
  markup_value  numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- One price per product per list
create unique index if not exists product_prices_product_list_uq
  on public.product_prices(product_id, price_list_id);

create index if not exists product_prices_org_id_idx
  on public.product_prices(org_id);

alter table public.product_prices enable row level security;

-- RLS policies
drop policy if exists product_prices_select on public.product_prices;
create policy product_prices_select on public.product_prices
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_prices.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_prices_insert on public.product_prices;
create policy product_prices_insert on public.product_prices
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_prices.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_prices_update on public.product_prices;
create policy product_prices_update on public.product_prices
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_prices.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

-- ============================================================
-- 3. Seed: one "Standard" price list per existing org
-- ============================================================
insert into public.product_price_lists (org_id, name, is_default)
select id, 'Standard', true
from public.organizations
on conflict do nothing;

commit;
