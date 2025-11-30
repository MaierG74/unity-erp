-- Phase A: Public site schema and publish mirrors (no media sync yet)
-- SAFE: additive only; does not modify existing ERP tables or policies except enabling RLS on new tables

begin;

-- 0) Schema
create schema if not exists web;

-- 1) Sidecar metadata table for publishing and SEO (author in ERP)
create table if not exists public.product_web_meta (
  product_id integer primary key references public.products(product_id) on delete cascade,
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  is_published boolean not null default false,
  published_at timestamptz,
  -- Phase A images: direct URL until storage/gallery is wired
  hero_image_url text,
  -- Optional editorial fields
  short_description text,
  long_description text,
  seo_title text,
  seo_description text,
  featured boolean not null default false,
  list_order integer default 0,
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
    create or replace trigger trg_product_web_meta_updated
      before update on public.product_web_meta
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.product_web_meta enable row level security;
create policy if not exists product_web_meta_authenticated_all on public.product_web_meta
  for all to authenticated using (true) with check (true);

-- 2) Public read-only mirrors consumed by the site
create table if not exists web.products_pub (
  id integer primary key, -- maps to products.product_id
  slug text unique not null,
  name text not null,
  short_description text,
  long_description text,
  hero_image_url text,
  seo_title text,
  seo_description text,
  featured boolean not null default false,
  list_order integer default 0,
  updated_at timestamptz not null default now()
);

create table if not exists web.categories_pub (
  id integer primary key, -- maps to product_categories.product_cat_id
  slug text unique not null,
  name text not null,
  parent_id integer,
  sort integer default 0,
  updated_at timestamptz not null default now()
);

-- RLS: public SELECT only on mirrors
alter table web.products_pub enable row level security;
alter table web.categories_pub enable row level security;

create policy if not exists public_read_products_pub on web.products_pub
  for select to anon, authenticated using (true);

create policy if not exists public_read_categories_pub on web.categories_pub
  for select to anon, authenticated using (true);

-- 3) Lead intake for website
create table if not exists web.quote_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) <= 200),
  email text not null check (char_length(email) <= 320),
  phone text check (char_length(phone) <= 50),
  message text check (char_length(message) <= 5000),
  items_json jsonb not null default '[]'::jsonb,
  source_page text,
  utm jsonb,
  ip_hash text,
  user_agent text
);

alter table web.quote_requests enable row level security;
create policy if not exists anon_insert_quote_requests on web.quote_requests
  for insert to anon with check (true);
create policy if not exists auth_all_quote_requests on web.quote_requests
  for all to authenticated using (true) with check (true);

-- 4) Sync logic: publish products into web.products_pub
create or replace function public.sync_web_product(p_product_id integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  meta public.product_web_meta;
  prod record;
begin
  select * into meta from public.product_web_meta where product_id = p_product_id;
  select product_id, name, description into prod from public.products where product_id = p_product_id;

  if meta is not null and meta.is_published and prod is not null then
    insert into web.products_pub (id, slug, name, short_description, long_description, hero_image_url,
                                  seo_title, seo_description, featured, list_order, updated_at)
    values (prod.product_id, meta.slug, prod.name, meta.short_description, coalesce(meta.long_description, prod.description), meta.hero_image_url,
            meta.seo_title, meta.seo_description, coalesce(meta.featured,false), coalesce(meta.list_order,0), now())
    on conflict (id) do update set
      slug = excluded.slug,
      name = excluded.name,
      short_description = excluded.short_description,
      long_description = excluded.long_description,
      hero_image_url = excluded.hero_image_url,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description,
      featured = excluded.featured,
      list_order = excluded.list_order,
      updated_at = now();
  else
    delete from web.products_pub where id = p_product_id;
  end if;
end $$;

create or replace function public.tg_sync_web_products_from_products()
returns trigger language plpgsql as $$
begin
  if tg_op = 'delete' then
    perform public.sync_web_product(old.product_id);
  else
    perform public.sync_web_product(new.product_id);
  end if;
  return null;
end $$;

create or replace function public.tg_sync_web_products_from_meta()
returns trigger language plpgsql as $$
begin
  if tg_op = 'delete' then
    perform public.sync_web_product(old.product_id);
  else
    perform public.sync_web_product(new.product_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_web_products_from_products on public.products;
create trigger trg_sync_web_products_from_products
  after insert or update or delete on public.products
  for each row execute function public.tg_sync_web_products_from_products();

drop trigger if exists trg_sync_web_products_from_meta on public.product_web_meta;
create trigger trg_sync_web_products_from_meta
  after insert or update or delete on public.product_web_meta
  for each row execute function public.tg_sync_web_products_from_meta();

-- 5) Categories mirror (optional but safe)
create or replace function public.tg_sync_web_categories()
returns trigger language plpgsql as $$
begin
  if tg_op = 'delete' then
    delete from web.categories_pub where id = old.product_cat_id;
  else
    insert into web.categories_pub (id, slug, name, parent_id, sort, updated_at)
    values (
      new.product_cat_id,
      coalesce((select slug from web.categories_pub where id = new.product_cat_id), lower(regexp_replace(new.categoryname, '\\s+', '-', 'g'))),
      new.categoryname,
      null,
      0,
      now()
    )
    on conflict (id) do update set
      slug = excluded.slug,
      name = excluded.name,
      parent_id = excluded.parent_id,
      sort = excluded.sort,
      updated_at = now();
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_web_categories on public.product_categories;
create trigger trg_sync_web_categories
  after insert or update or delete on public.product_categories
  for each row execute function public.tg_sync_web_categories();

-- 6) Revalidation outbox on publish/slug change
create table if not exists public.site_revalidate_outbox (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  event text not null,
  product_id integer,
  slug text
);

create or replace function public.tg_revalidate_on_publish()
returns trigger language plpgsql as $$
begin
  if tg_op = 'update' then
    if (coalesce(old.is_published,false) = false and new.is_published = true)
       or (old.slug is distinct from new.slug) then
      insert into public.site_revalidate_outbox(event, product_id, slug)
      values ('product_publish_or_slug_change', new.product_id, new.slug);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_revalidate_on_publish on public.product_web_meta;
create trigger trg_revalidate_on_publish
  after update on public.product_web_meta
  for each row execute function public.tg_revalidate_on_publish();

commit;