# QButton Public Site ↔ Unity ERP Integration Plan

Status: Draft
Owners: Gregory + AR assistants

## Objectives
- Keep ERP and public site as separate apps and repos
- Share a single Supabase project/database with strict RLS
- Zero disruption to ERP; changes are incremental and reversible

## Architecture
- Two apps:
  - ERP: `~/Documents/Projects/unity-erp`
  - Public site: `~/Documents/Projects/QButton/qbutton-web`
- Shared Supabase project
- ERP repo owns all DB migrations and schema
- Site reads via anon key; writes only to `web.quote_requests`

## Database Design (new `web` schema)
- `web.categories` (id, slug, name, parent_id, sort)
- `web.products` (id, slug, name, short_description, long_description, status, category_id, seo fields)
- `web.product_media` (product_id, storage_path, alt, kind, sort)
- `web.material_options` (name, vendor, swatch_path, metadata)
- `web.product_materials` (product_id, material_option_id, constraints)
- `web.quote_requests` (id, created_at, name, email, phone, message, items_json, source_page, utm, ip_hash, user_agent)

## RLS Policies
- Public read-only select on products/categories/media/materials
- Insert-only for `web.quote_requests` (with guards: payload size, rate limiting)
- All write access restricted to ERP-authenticated roles

## Storage Buckets
- `product-images` (public-read, ERP-only upload)
- `site-media` (optional)

## Public Site (qbutton-web)
- Data fetching via anon Supabase client in server components
- Product/category pages: SSG with ISR (revalidate)
- Quote request flow: server action inserts into `web.quote_requests`
- Revalidate endpoint to refresh published pages on ERP updates

## ERP (unity-erp)
- CRUD UI for `web.*` tables (catalog, media, materials)
- Lead inbox for `web.quote_requests` with "Convert to Quote"
- Triggers or actions to revalidate site pages after publish

## Security & Abuse Protection
- Tight RLS and minimal exposed columns
- hCaptcha/Turnstile on quote form (phase 2)
- IP hashing and basic rate limiting in DB function

## Environments & Deployments
- Staging Supabase recommended for initial rollout; switch to prod later
- Independent deploys for ERP and site; shared DB URL

## Observability
- App logs + Supabase logs
- Error tracking (Sentry) optional
- Basic metrics for quote conversion

## Phased Rollout
1. Discovery (no code changes)
2. DB foundation: create `web` schema + initial tables, RLS (staging)
3. Site wiring: read products, submit quote requests, ISR
4. ERP integration: catalog management + lead triage
5. Notifications: email/Slack on new leads; optional auto-ack
6. Launch: QA, SEO, DNS, monitoring
7. Post-launch: variants, pricing, search, CMS

## Decision Log
- Architecture: separate apps, shared DB (approved)
- Ownership: ERP repo owns migrations (proposed)
- Notifications provider: TBD

## Open Questions
- Do we need a staging Supabase now, or work directly on current project?
- Preferred email provider for notifications?
- Any ERP table naming collisions to avoid?

## Current DB snapshot (read-only)

Schemas present:

- `auth`, `public`, `storage`, `realtime`, `vault`, `extensions`, `graphql`, `graphql_public`, `supabase_migrations`, plus system schemas

Key public tables (subset):

- `products`, `product_images`, `product_categories`, `product_category_assignments`
- `quotes`, `quote_items`, `quote_attachments`, `quote_item_clusters`, `quote_cluster_lines`, `quote_company_settings`
- `orders`, `order_details`, `order_attachments`, `order_statuses`
- `components`, `component_categories`, `suppliercomponents`, `suppliers`, `supplier_orders`, ...
- `staff`, `time_clock_events`, `time_daily_summary`, `staff_hours`, payroll-related tables

Notable policies (subset):

- Many `public` tables currently have permissive policies (ALL for `{public}` or wide `{authenticated}`), suitable for ERP but not for public site exposure. We will avoid exposing these directly to anon clients.

Storage buckets:

- `QButton` (public), `quote-files` (public), `Test` (public)

Functions (subset of custom in `public`):

- `ensure_one_primary_image`, `process_clock_event*`, `get_*` component/order helpers, and various triggers

Implications:

- We should introduce a new `web` schema for the public site and expose only curated data via RLS-safe tables or views. ERP tables remain unchanged.

## First step (no-risk)

- Add a migration in ERP repo to create schema `web` only (no tables yet). This is safe and does not affect existing code.
- In the same migration, optionally add a `web.read_products` view selecting from `public.products` and related media as a placeholder for integration discussions (but keep it private for now; no RLS grants yet).
- Do this first in staging if available; otherwise, run at a quiet time in production. We will not change any existing RLS.

## Dual-project consolidation (qbutton-site ➜ Qbutton)

Goal: point the public site to the ERP Supabase project (`Qbutton`) and retire the separate `qbutton-site` project without running dual live configs.

Checklist:

1) Inventory legacy site project (read-only)
- List tables and row counts in `qbutton-site`
- Identify any data to keep (products, media pointers, materials, leads)
- Confirm buckets to migrate (if any)

2) Prepare target in ERP project
- Create `web` schema (first step above)
- Define initial `web` tables/views and RLS (read-only anon for catalog; insert-only anon for leads)
- Create storage buckets: `product-images` (public), `site-media` (optional)

3) Data migration (one-off)
- If small: write a scripted SQL/Node copy job (source: `qbutton-site`, target: `Qbutton`)
- If larger: `pg_dump` selected tables from `qbutton-site` and import into `web.*` in `Qbutton`
- Keep old IDs or map to new IDs depending on model

4) Site configuration switch
- Add `qbutton-web/.env.production` pointing to `Qbutton` (ERP) anon URL+key
- Keep `qbutton-web/.env.legacy` with old values for rollback; not used at runtime
- For local dev, use staging ERP project via `.env.local` if available

5) Dry run and QA
- Point local `qbutton-web` to ERP staging; build, run, and smoke-test catalog + quote requests
- Verify ISR/revalidate endpoints and RLS behavior

6) Cutover
- Deploy site with new env vars (ERP `Qbutton`)
- Monitor errors and DB writes; keep `qbutton-site` project paused and retained for 7–14 days

Backout plan:
- Revert environment variables to `.env.legacy` values and redeploy site
- No schema changes rolled back; ERP `web` schema remains

## SQL draft (for review, do not apply yet)

### 0) Create schema `web`

```sql
create schema if not exists web;
```

### 1) Sidecar metadata on ERP products (author in ERP)

```sql
create table if not exists public.product_web_meta (
  product_id uuid primary key references public.products(id) on delete cascade,
  slug text unique not null check (slug ~ '^[a-z0-9-]+$'),
  is_published boolean not null default false,
  published_at timestamptz,
  short_description text,
  long_description text,
  seo_title text,
  seo_description text,
  featured boolean not null default false,
  list_order integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stamp updated_at on change (uses existing helper if present)
do $$ begin
  if exists (
    select 1 from pg_proc where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace
  ) then
    create or replace trigger trg_product_web_meta_updated
      before update on public.product_web_meta
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.product_web_meta enable row level security;
-- ERP-only access; site never touches this table
create policy if not exists product_web_meta_authenticated_all on public.product_web_meta
  for all to authenticated using (true) with check (true);
```

### 2) Public, read-only mirrors for the site (`web` schema)

```sql
create table if not exists web.categories_pub (
  id uuid primary key,
  slug text unique not null,
  name text not null,
  parent_id uuid,
  sort integer default 0,
  updated_at timestamptz not null default now()
);

create table if not exists web.products_pub (
  id uuid primary key,
  slug text unique not null,
  name text not null,
  short_description text,
  long_description text,
  category_id uuid,
  seo_title text,
  seo_description text,
  featured boolean not null default false,
  list_order integer default 0,
  updated_at timestamptz not null default now()
);

create table if not exists web.product_media_pub (
  id uuid primary key,
  product_id uuid not null references web.products_pub(id) on delete cascade,
  storage_path text not null,
  alt text,
  kind text not null default 'image',
  is_primary boolean not null default false,
  sort integer default 0
);

-- RLS: public read-only
alter table web.categories_pub enable row level security;
alter table web.products_pub enable row level security;
alter table web.product_media_pub enable row level security;

create policy if not exists public_read_categories_pub on web.categories_pub
  for select to anon, authenticated using (true);
create policy if not exists public_read_products_pub on web.products_pub
  for select to anon, authenticated using (true);
create policy if not exists public_read_product_media_pub on web.product_media_pub
  for select to anon, authenticated using (true);
```

### 3) Lead intake table for website

```sql
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

-- Allow anonymous inserts only; no reads for anon
create policy if not exists anon_insert_quote_requests on web.quote_requests
  for insert to anon with check (true);

-- ERP can read/manage
create policy if not exists auth_all_quote_requests on web.quote_requests
  for all to authenticated using (true) with check (true);
```

### 4) Sync logic from ERP tables into `web.*_pub`

```sql
-- Upsert/delete published product row based on metadata
create or replace function public.sync_web_product(p_product_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  meta public.product_web_meta;
  prod public.products;
begin
  select * into meta from public.product_web_meta where product_id = p_product_id;
  select * into prod from public.products where id = p_product_id;

  if meta is not null and meta.is_published and prod is not null then
    insert into web.products_pub (id, slug, name, short_description, long_description,
                                  seo_title, seo_description, featured, list_order, updated_at)
    values (prod.id, meta.slug, prod.name, meta.short_description, meta.long_description,
            meta.seo_title, meta.seo_description, coalesce(meta.featured,false), coalesce(meta.list_order,0), now())
    on conflict (id) do update set
      slug = excluded.slug,
      name = excluded.name,
      short_description = excluded.short_description,
      long_description = excluded.long_description,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description,
      featured = excluded.featured,
      list_order = excluded.list_order,
      updated_at = now();
  else
    delete from web.product_media_pub where product_id = p_product_id;
    delete from web.products_pub where id = p_product_id;
  end if;
end $$;

-- Trigger wrappers on products and product_web_meta
create or replace function public.tg_sync_web_products_from_products()
returns trigger language plpgsql as $$
begin
  if tg_op = 'delete' then
    perform public.sync_web_product(old.id);
  else
    perform public.sync_web_product(new.id);
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

-- Media sync: reflect product_images only when product is published
create or replace function public.tg_sync_web_media()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta public.product_web_meta;
  rec public.product_images;
  pid uuid;
begin
  if tg_op = 'delete' then
    pid := old.product_id;
    delete from web.product_media_pub where id = old.id;
  else
    pid := new.product_id;
    select * into rec from public.product_images where id = new.id;
    select * into meta from public.product_web_meta where product_id = pid;
    if meta is not null and meta.is_published then
      insert into web.product_media_pub (id, product_id, storage_path, alt, kind, is_primary, sort)
      values (rec.id, rec.product_id, rec.storage_path, rec.alt, coalesce(rec.kind,'image'), coalesce(rec.is_primary,false), coalesce(rec.sort_order,0))
      on conflict (id) do update set
        product_id = excluded.product_id,
        storage_path = excluded.storage_path,
        alt = excluded.alt,
        kind = excluded.kind,
        is_primary = excluded.is_primary,
        sort = excluded.sort;
    else
      delete from web.product_media_pub where id = rec.id;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_web_media on public.product_images;
create trigger trg_sync_web_media
  after insert or update or delete on public.product_images
  for each row execute function public.tg_sync_web_media();

-- Categories mirror (optional): upsert from product_categories
create or replace function public.tg_sync_web_categories()
returns trigger language plpgsql as $$
begin
  if tg_op = 'delete' then
    delete from web.categories_pub where id = old.id;
  else
    insert into web.categories_pub (id, slug, name, parent_id, sort, updated_at)
    values (new.id, coalesce(new.slug, lower(regexp_replace(new.name, '\\s+', '-', 'g'))), new.name, new.parent_id, coalesce(new.sort,0), now())
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
```

### 5) Revalidation outbox (site cache refresh)

```sql
create table if not exists public.site_revalidate_outbox (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  event text not null,
  product_id uuid,
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
```

Notes:
- Category slug source assumes `public.product_categories.slug` exists; otherwise we derive a best-effort slug from `name`.
- If `public.product_images` columns differ (e.g., `path` vs `storage_path`, `order` vs `sort_order`), we will adjust before applying.

## Site wiring tasks (qbutton-web)

- Read products from `web.products_pub` and images from `web.product_media_pub` in server components
- Product listing and detail pages use ISR; add a signed revalidate endpoint that ERP calls when outbox entries are created
- Quote form server action inserts into `web.quote_requests`; client adds basic validation and, later, hCaptcha/Turnstile
- Update `.env.production` to point to ERP Supabase project; keep `.env.legacy` for rollback
