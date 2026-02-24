# Tenant Data Isolation Zero-Downtime Runbook

## Purpose
Safely introduce row-level tenant scoping (`org_id`) to live domain data with no user-facing downtime, starting from the current production reality:

1. Existing live users are all in a single organization (`Qbutton`).
2. Module entitlements already exist (`organizations`, `organization_members`, `module_catalog`, `organization_module_entitlements`).
3. Core domain tables (`orders/products/stock`) are largely not tenant-scoped yet.

This runbook is designed to prevent accidental lockout of live users while migrating toward true multi-tenant isolation.

## Scope (Phase A)
Critical tables for this run:

1. `public.orders`
2. `public.order_details`
3. `public.products`
4. `public.product_inventory` (if present)
5. `public.product_inventory_transactions` (if present)
6. `public.product_reservations` (if present)
7. `public.components`
8. `public.inventory`
9. `public.inventory_transactions`
10. `public.customers`

## Scope (Phase B) (follow-on)
Next priority domain tables (expand first, enforce later):

1. Purchasing + Suppliers (e.g. `purchase_orders`, `supplier_orders`, `suppliers`, `suppliercomponents`, receipts/returns, attachments)
2. Quotes (e.g. `quotes`, `quote_items`, quote cutlists/attachments/email logs)
3. Staff (e.g. `staff`, `staff_hours`, payroll tables)

## Migration file for Stage 1
Use this migration as the executable "expand-only" phase:

1. `supabase/migrations/20260214_tenant_org_scoping_expand_phase_a.sql`

What it does:
1. Adds nullable `org_id` columns.
2. Sets temporary default `org_id` (prefers org named `Qbutton`; falls back only when exactly one org exists).
3. Adds `NOT VALID` FKs to `organizations`.
4. Adds `org_id` indexes.

## Migration file for Phase B expand-only
Use this migration to extend `org_id` columns + defaults + backfill to purchasing/quotes/staff tables (no RLS changes):

1. `supabase/migrations/20260215_tenant_org_scoping_expand_phase_b_purchasing_quotes_staff.sql`

## Migration file for Phase C expand-only (timekeeping)
Use this migration to extend `org_id` columns + defaults + backfill to timekeeping tables before RLS tightening:

1. `supabase/migrations/20260221_tenant_org_scoping_expand_phase_c_timekeeping.sql`

## Migration file for Phase C FK validation
Use this migration after Phase C backfill to validate org foreign keys:

1. `supabase/migrations/20260221_tenant_org_scoping_phase_c_validate_org_fks.sql`

## Migration file for Phase C NOT NULL enforcement
Use this migration after null checks and FK validation are complete:

1. `supabase/migrations/20260221_tenant_org_scoping_phase_c_enforce_org_not_null.sql`

## Non-goals (for this run)
1. Full RLS rollout across every table in one deployment.
2. Reworking all unique constraints for multi-org duplicates in one step.
3. Tenant-scoping every historical/auxiliary table immediately.

## Safety principles
1. Expand first, enforce later.
2. Every schema change is additive and backward-compatible until final cutover.
3. No strict `NOT NULL` or RLS enforcement until data and application behavior are validated.
4. Use explicit go/no-go gates after each stage.

---

## Stage 0: Preflight (mandatory)

### 0.1 Confirm `Qbutton` org id
```sql
select id, name
from public.organizations
where lower(name) = lower('Qbutton');
```

Record this UUID as `QBUTTON_ORG_UUID`.

### 0.2 Confirm there is one active org context for live users
```sql
select
  o.id as org_id,
  o.name,
  count(*) as active_members
from public.organization_members m
join public.organizations o on o.id = m.org_id
where m.is_active = true
group by o.id, o.name
order by active_members desc;
```

### 0.2b Confirm every auth user has an org membership (prevents partial-null joins)
If a user can access some tables but not others (because tenant-scoped RLS is enabled on only part of the schema),
Supabase nested selects can return `null` for restricted relations, which can crash the UI if not guarded.

List users with no membership:
```sql
select u.id, u.email
from auth.users u
left join public.organization_members m on m.user_id = u.id
where m.user_id is null
order by u.created_at desc;
```

If (and only if) you are still in the single-tenant world (all users belong to `Qbutton`), you can backfill memberships:
```sql
-- Replace QBUTTON_ORG_UUID before running.
insert into public.organization_members (user_id, org_id, role, is_active)
select u.id, 'QBUTTON_ORG_UUID'::uuid, 'staff', true
from auth.users u
left join public.organization_members m on m.user_id = u.id
where m.user_id is null
on conflict (user_id, org_id)
do update set
  role = excluded.role,
  is_active = excluded.is_active,
  updated_at = now();
```

### 0.3 Capture baseline counts/totals (orders/products/stock)
```sql
select 'orders' as metric, count(*)::bigint as value from public.orders
union all
select 'order_details', count(*)::bigint from public.order_details
union all
select 'products', count(*)::bigint from public.products
union all
select 'product_inventory_rows', count(*)::bigint from public.product_inventory
union all
select 'product_inventory_on_hand_total', coalesce(sum(quantity_on_hand),0)::bigint from public.product_inventory
union all
select 'component_inventory_rows', count(*)::bigint from public.inventory
union all
select 'component_inventory_on_hand_total', coalesce(sum(quantity_on_hand),0)::bigint from public.inventory
union all
select 'inventory_transactions', count(*)::bigint from public.inventory_transactions;
```

### 0.4 Create a DB restore point/backup
Use Supabase backup tooling before Stage 1.

### Go/No-Go Gate 0
Proceed only if:
1. `QBUTTON_ORG_UUID` is identified.
2. Baseline snapshot is captured.
3. Backup/restore point exists.

---

## Stage 1: Expand schema (no behavior change)

Run during normal hours. These are additive changes only.

### 1.1 Add `org_id` columns (nullable) to core tables
Replace `QBUTTON_ORG_UUID` below with the real UUID.

```sql
alter table public.customers add column if not exists org_id uuid;
alter table public.products add column if not exists org_id uuid;
alter table public.components add column if not exists org_id uuid;
alter table public.orders add column if not exists org_id uuid;
alter table public.order_details add column if not exists org_id uuid;
alter table public.inventory add column if not exists org_id uuid;
alter table public.inventory_transactions add column if not exists org_id uuid;

-- Optional/feature tables; run only if table exists
do $$
begin
  if to_regclass('public.product_inventory') is not null then
    execute 'alter table public.product_inventory add column if not exists org_id uuid';
  end if;
  if to_regclass('public.product_inventory_transactions') is not null then
    execute 'alter table public.product_inventory_transactions add column if not exists org_id uuid';
  end if;
  if to_regclass('public.product_reservations') is not null then
    execute 'alter table public.product_reservations add column if not exists org_id uuid';
  end if;
end $$;
```

### 1.2 Set temporary defaults to `Qbutton` for legacy writes
This keeps old code paths safe while app changes are rolling out.

```sql
alter table public.customers alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;
alter table public.products alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;
alter table public.components alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;
alter table public.orders alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;
alter table public.order_details alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;
alter table public.inventory alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;
alter table public.inventory_transactions alter column org_id set default 'QBUTTON_ORG_UUID'::uuid;

do $$
begin
  if to_regclass('public.product_inventory') is not null then
    execute 'alter table public.product_inventory alter column org_id set default ''QBUTTON_ORG_UUID''::uuid';
  end if;
  if to_regclass('public.product_inventory_transactions') is not null then
    execute 'alter table public.product_inventory_transactions alter column org_id set default ''QBUTTON_ORG_UUID''::uuid';
  end if;
  if to_regclass('public.product_reservations') is not null then
    execute 'alter table public.product_reservations alter column org_id set default ''QBUTTON_ORG_UUID''::uuid';
  end if;
end $$;
```

### 1.3 Add foreign keys as `NOT VALID` (no full table lock scan)
```sql
alter table public.customers
  add constraint customers_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;

alter table public.products
  add constraint products_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;

alter table public.components
  add constraint components_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;

alter table public.orders
  add constraint orders_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;

alter table public.order_details
  add constraint order_details_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;

alter table public.inventory
  add constraint inventory_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;

alter table public.inventory_transactions
  add constraint inventory_transactions_org_id_fkey
  foreign key (org_id) references public.organizations(id) not valid;
```

Optional table FKs:
```sql
do $$
begin
  if to_regclass('public.product_inventory') is not null then
    execute '
      alter table public.product_inventory
      add constraint product_inventory_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid
    ';
  end if;

  if to_regclass('public.product_inventory_transactions') is not null then
    execute '
      alter table public.product_inventory_transactions
      add constraint product_inventory_transactions_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid
    ';
  end if;

  if to_regclass('public.product_reservations') is not null then
    execute '
      alter table public.product_reservations
      add constraint product_reservations_org_id_fkey
      foreign key (org_id) references public.organizations(id) not valid
    ';
  end if;
end $$;
```

### 1.4 Add indexes on `org_id`
Run `CONCURRENTLY` statements one-by-one outside transaction blocks.

```sql
create index concurrently if not exists idx_customers_org_id on public.customers(org_id);
create index concurrently if not exists idx_products_org_id on public.products(org_id);
create index concurrently if not exists idx_components_org_id on public.components(org_id);
create index concurrently if not exists idx_orders_org_id on public.orders(org_id);
create index concurrently if not exists idx_order_details_org_id on public.order_details(org_id);
create index concurrently if not exists idx_inventory_org_id on public.inventory(org_id);
create index concurrently if not exists idx_inventory_transactions_org_id on public.inventory_transactions(org_id);
create index concurrently if not exists idx_product_inventory_org_id on public.product_inventory(org_id);
create index concurrently if not exists idx_product_inventory_transactions_org_id on public.product_inventory_transactions(org_id);
create index concurrently if not exists idx_product_reservations_org_id on public.product_reservations(org_id);
```

### Go/No-Go Gate 1
Proceed only if:
1. Application remains functional (no behavior change expected).
2. No migration errors.
3. New columns/defaults exist.

Check:
```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and column_name = 'org_id'
  and table_name in (
    'customers','products','components','orders','order_details',
    'inventory','inventory_transactions','product_inventory',
    'product_inventory_transactions','product_reservations'
  )
order by table_name;
```

---

## Stage 2: Backfill existing rows to `Qbutton`

Given current production uses one org, backfill is deterministic.

```sql
update public.customers set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.products set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.components set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.orders set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.order_details set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.inventory set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.inventory_transactions set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
```

Optional tables:
```sql
do $$
begin
  if to_regclass('public.product_inventory') is not null then
    execute 'update public.product_inventory set org_id = ''QBUTTON_ORG_UUID''::uuid where org_id is null';
  end if;
  if to_regclass('public.product_inventory_transactions') is not null then
    execute 'update public.product_inventory_transactions set org_id = ''QBUTTON_ORG_UUID''::uuid where org_id is null';
  end if;
  if to_regclass('public.product_reservations') is not null then
    execute 'update public.product_reservations set org_id = ''QBUTTON_ORG_UUID''::uuid where org_id is null';
  end if;
end $$;
```

### 2.1 Validate parent-child org consistency (critical)

Orders to order details:
```sql
select count(*) as mismatches
from public.order_details od
join public.orders o on o.order_id = od.order_id
where od.org_id is distinct from o.org_id;
```

Orders to customers:
```sql
select count(*) as mismatches
from public.orders o
join public.customers c on c.id = o.customer_id
where o.org_id is distinct from c.org_id;
```

Order details to products:
```sql
select count(*) as mismatches
from public.order_details od
join public.products p on p.product_id = od.product_id
where od.org_id is distinct from p.org_id;
```

Product stock to products (if table exists):
```sql
select count(*) as mismatches
from public.product_inventory pi
join public.products p on p.product_id = pi.product_id
where pi.org_id is distinct from p.org_id;
```

Reservations to products + orders (if table exists):
```sql
select count(*) as mismatches
from public.product_reservations pr
join public.products p on p.product_id = pr.product_id
join public.orders o on o.order_id = pr.order_id
where pr.org_id is distinct from p.org_id
   or pr.org_id is distinct from o.org_id
   or p.org_id is distinct from o.org_id;
```

Component stock to components:
```sql
select count(*) as mismatches
from public.inventory i
join public.components c on c.component_id = i.component_id
where i.org_id is distinct from c.org_id;
```

Component stock transactions to components/orders:
```sql
select count(*) as mismatches
from public.inventory_transactions it
left join public.components c on c.component_id = it.component_id
left join public.orders o on o.order_id = it.order_id
where (it.component_id is not null and it.org_id is distinct from c.org_id)
   or (it.order_id is not null and it.org_id is distinct from o.org_id);
```

### 2.2 Validate nulls removed from critical tables
```sql
select 'orders' as table_name, count(*) as null_org_rows from public.orders where org_id is null
union all
select 'order_details', count(*) from public.order_details where org_id is null
union all
select 'products', count(*) from public.products where org_id is null
union all
select 'customers', count(*) from public.customers where org_id is null
union all
select 'components', count(*) from public.components where org_id is null
union all
select 'inventory', count(*) from public.inventory where org_id is null
union all
select 'inventory_transactions', count(*) from public.inventory_transactions where org_id is null
union all
select 'product_inventory', count(*) from public.product_inventory where org_id is null;
```

### Go/No-Go Gate 2
Proceed only if:
1. All null-org counts for critical tables are `0`.
2. All mismatch queries return `0`.
3. Baseline counts/totals still match Stage 0 snapshot.

---

## Stage 3: Application dual-write + dual-read deployment

Deploy application changes with feature flag support.

### 3.1 Required behavior in app code
1. All writes to scoped tables include `org_id` from resolved user org context.
2. Reads apply org filters:
   - `where org_id = :resolved_org_id`
3. Temporary safety during cutover:
   - keep a fallback mode that can include legacy nulls (`org_id is null`) if emergency rollback is needed.

Implemented product-domain hardening (2026-02-15):
1. `app/api/products/route.ts` now stamps/scopes `org_id` for list/create.
2. `app/api/products/[productId]/route.ts` now scopes product ownership checks and mutations by `org_id`.
3. `app/api/products/[productId]/add-fg/route.ts` now scopes product inventory reads/writes by `org_id`.
4. `app/api/products/[productId]/cutlist-groups/route.ts` now verifies product ownership using (`product_id`, `org_id`) before reading/writing groups.
5. `product_cutlist_groups` org scoping was completed in follow-up steps:
   - Expand-only migration: `supabase/migrations/20260220_tenant_org_scoping_expand_product_cutlist_groups.sql`
   - Constraint enforcement: Step 5.46
   - RLS tightening: Step 5.47

Implemented orders-domain hardening (2026-02-15):
1. `app/api/orders/[orderId]/route.ts` now scopes order update/delete flows by (`order_id`, `org_id`).
2. `app/api/orders/[orderId]/add-products/route.ts` now stamps `order_details.org_id` and scopes order reads/writes by `org_id`.
3. `app/api/orders/from-quote/route.ts` now stamps `orders.org_id`/`order_details.org_id` and scopes customer/product resolution by `org_id`.
4. Finished-goods order routes now require module/org context and validate order ownership before actions:
   - `app/api/orders/[orderId]/reserve-fg/route.ts`
   - `app/api/orders/[orderId]/release-fg/route.ts`
   - `app/api/orders/[orderId]/consume-fg/route.ts`
   - `app/api/orders/[orderId]/fg-reservations/route.ts`

### 3.2 Production smoke tests (orders/products/stock)
Run immediately after deploy with a real Qbutton admin user:

1. Products:
   - list products
   - create product
   - edit product
   - delete test product
2. Orders:
   - create order
   - add/remove line item
   - update status
3. Stock:
   - add finished goods (`/api/products/:id/add-fg`)
   - reserve/release/consume FG
   - receive component stock (purchase flow)

### Go/No-Go Gate 3
Proceed only if:
1. No user-facing regression in the smoke tests.
2. New rows are written with non-null `org_id`.

Quick checks:
```sql
select order_id, org_id from public.orders order by order_id desc limit 20;
select product_id, org_id from public.products order by product_id desc limit 20;
select product_inventory_id, product_id, org_id from public.product_inventory order by product_inventory_id desc limit 20;
select transaction_id, component_id, order_id, org_id from public.inventory_transactions order by transaction_id desc limit 20;
```

---

## Stage 4: Enforce integrity constraints (after stable period)

Do this only after at least one stable release cycle.

Implemented in production (2026-02-15):
1. Migration applied: `supabase/migrations/20260215_tenant_org_scoping_stage4_enforce.sql`.
2. All `*_org_id_fkey` constraints for scoped domain tables are now validated.
3. `org_id` is now enforced as `NOT NULL` on scoped domain tables:
   - `customers`, `products`, `components`, `orders`, `order_details`,
   - `inventory`, `inventory_transactions`,
   - `product_inventory`, `product_inventory_transactions`, `product_reservations`.
4. Post-migration verification confirmed:
   - zero `org_id` null rows,
   - all `*_org_id_not_null` checks validated,
   - all scoped tables report `org_id` column `is_nullable = NO`.

### 4.1 Validate foreign keys
```sql
alter table public.customers validate constraint customers_org_id_fkey;
alter table public.products validate constraint products_org_id_fkey;
alter table public.components validate constraint components_org_id_fkey;
alter table public.orders validate constraint orders_org_id_fkey;
alter table public.order_details validate constraint order_details_org_id_fkey;
alter table public.inventory validate constraint inventory_org_id_fkey;
alter table public.inventory_transactions validate constraint inventory_transactions_org_id_fkey;
```

### 4.2 Add `NOT NULL` (or check constraints first)
Safer two-step:
```sql
alter table public.orders add constraint orders_org_id_not_null check (org_id is not null) not valid;
alter table public.orders validate constraint orders_org_id_not_null;
```

Repeat for other critical tables, then optionally:
```sql
alter table public.orders alter column org_id set not null;
```

### 4.3 RLS rollout (separate controlled release)
Enable RLS per table only after API/service-role strategy is confirmed.

---

## Stage 5: RLS rollout in baby steps (production-safe sequence)

Principle:
1. Change one table at a time.
2. Verify immediately after each change.
3. Keep a tested rollback SQL snippet ready for each step.

### Step 5.1 (completed on 2026-02-15): `public.products`

What changed:
1. Removed broad policy `authenticated_users_all_access` on `public.products`.
2. Added org-scoped policies for authenticated users:
   - `products_select_org_member`
   - `products_insert_org_member`
   - `products_update_org_member`
   - `products_delete_org_member`
3. Policy condition uses active org membership:
   - `organization_members.user_id = auth.uid()`
   - `organization_members.org_id = products.org_id`
   - `is_active = true`
   - `banned_until` is null or in the past.

Verification performed:
1. Confirmed `public.products` still has `RLS enabled = true`.
2. Confirmed only org-scoped product policies exist.
3. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step1_products`.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists products_select_org_member on public.products;
drop policy if exists products_insert_org_member on public.products;
drop policy if exists products_update_org_member on public.products;
drop policy if exists products_delete_org_member on public.products;
create policy authenticated_users_all_access
on public.products
for all
to public
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
commit;
```

### Step 5.2 (completed on 2026-02-15): `public.customers`

What changed:
1. Removed broad customer policies:
   - `All Access Customers`
   - `Authenticated users can delete customers`
   - `Authenticated users can insert customers`
   - `Authenticated users can select customers`
   - `Authenticated users can update customers`
2. Added org-scoped policies for authenticated users:
   - `customers_select_org_member`
   - `customers_insert_org_member`
   - `customers_update_org_member`
   - `customers_delete_org_member`
3. Policy condition uses active org membership:
   - `organization_members.user_id = auth.uid()`
   - `organization_members.org_id = customers.org_id`
   - `is_active = true`
   - `banned_until` is null or in the past.

Verification performed:
1. Confirmed only org-scoped customer policies exist.
2. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step2_customers`.
3. Confirmed `customers.org_id` has zero null rows.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists customers_select_org_member on public.customers;
drop policy if exists customers_insert_org_member on public.customers;
drop policy if exists customers_update_org_member on public.customers;
drop policy if exists customers_delete_org_member on public.customers;
create policy "All Access Customers"
on public.customers
for all
to public
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
create policy "Authenticated users can delete customers"
on public.customers for delete to authenticated using (true);
create policy "Authenticated users can insert customers"
on public.customers for insert to authenticated with check (true);
create policy "Authenticated users can select customers"
on public.customers for select to authenticated using (true);
create policy "Authenticated users can update customers"
on public.customers for update to authenticated using (true) with check (true);
commit;
```

### Step 5.3 (completed on 2026-02-15): `public.product_inventory`

What changed:
1. Removed broad policy `product_inventory_authenticated_all`.
2. Added org-scoped policies:
   - `product_inventory_select_org_member`
   - `product_inventory_insert_org_member`
   - `product_inventory_update_org_member`
   - `product_inventory_delete_org_member`

Verification performed:
1. Confirmed only org-scoped `product_inventory` policies exist.
2. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step3_product_inventory`.
3. Confirmed `product_inventory.org_id` has zero null rows.

### Step 5.4 (completed on 2026-02-15): `public.product_reservations`

What changed:
1. Removed broad policy `product_reservations_authenticated_all`.
2. Added org-scoped policies:
   - `product_reservations_select_org_member`
   - `product_reservations_insert_org_member`
   - `product_reservations_update_org_member`
   - `product_reservations_delete_org_member`

Verification performed:
1. Confirmed only org-scoped `product_reservations` policies exist.
2. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step4_product_reservations`.
3. Confirmed `product_reservations.org_id` has zero null rows.

### Step 5.5 (completed on 2026-02-15): `public.orders` policy prep (no RLS enable yet)

What changed:
1. Removed broad legacy policy `All Access Orders`.
2. Added org-scoped policies:
   - `orders_select_org_member`
   - `orders_insert_org_member`
   - `orders_update_org_member`
   - `orders_delete_org_member`

Verification performed:
1. Confirmed new `orders_*_org_member` policies exist.
2. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step5_orders_policy_prep`.
3. If `public.orders` has `RLS enabled = false`, there is no behavior change yet. If it is already `true`, this step is a live behavior change (run smoke tests immediately).

### Step 5.6 (completed on 2026-02-15): `public.order_details` policy prep (no RLS enable yet)

What changed:
1. Added org-scoped policies:
   - `order_details_select_org_member`
   - `order_details_insert_org_member`
   - `order_details_update_org_member`
   - `order_details_delete_org_member`

Verification performed:
1. Confirmed new `order_details_*_org_member` policies exist.
2. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step6_order_details_policy_prep`.
3. If `public.order_details` has `RLS enabled = false`, there is no behavior change yet. If it is already `true`, this step is a live behavior change (run smoke tests immediately).

---

### Step 5.7 (completed on 2026-02-15): Enable RLS on `public.orders`

What changed:
1. Enabled (or confirmed enabled) Row Level Security on `public.orders` so the org-scoped policies take effect.

Verification performed:
1. Confirmed `public.orders` has `RLS enabled = true`.
2. Confirmed a real Qbutton user can still see orders, and a non-member sees zero rows (via SQL session simulation).
3. UI smoke: `/orders` loads and lists expected orders.

Immediate rollback SQL (if needed):
```sql
alter table public.orders disable row level security;
```

### Step 5.8 (completed on 2026-02-15): Enable RLS on `public.order_details`

What changed:
1. Enabled (or confirmed enabled) Row Level Security on `public.order_details` so the org-scoped policies take effect.

Verification performed:
1. Confirmed `public.order_details` has `RLS enabled = true`.
2. UI smoke: orders list/detail still loads (even if `order_details` is sparse/empty in prod).

Immediate rollback SQL (if needed):
```sql
alter table public.order_details disable row level security;
```

### Step 5.9 (completed on 2026-02-15): `public.inventory_transactions`

What changed:
1. Added org-scoped policies:
   - `inventory_transactions_select_org_member`
   - `inventory_transactions_insert_org_member`
   - `inventory_transactions_update_org_member`
   - `inventory_transactions_delete_org_member`
2. Removed broad policy `authenticated_users_all_access`.

Verification performed:
1. Confirmed Qbutton user can see inventory transactions; non-member sees zero rows (SQL simulation).
2. UI smoke: Inventory → Transactions tab loads and shows recent transactions.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists inventory_transactions_select_org_member on public.inventory_transactions;
drop policy if exists inventory_transactions_insert_org_member on public.inventory_transactions;
drop policy if exists inventory_transactions_update_org_member on public.inventory_transactions;
drop policy if exists inventory_transactions_delete_org_member on public.inventory_transactions;
create policy authenticated_users_all_access
on public.inventory_transactions
for all
to public
using (auth.role() = 'authenticated'::text)
with check (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.10 (completed on 2026-02-15): `public.inventory`

What changed:
1. Removed broad policies (including anon read):
   - `Allow anon read inventory`
   - `Allow authenticated read inventory`
   - `Allow authenticated insert inventory`
   - `Allow authenticated update inventory`
   - `Allow authenticated delete inventory`
2. Added org-scoped policies:
   - `inventory_select_org_member`
   - `inventory_insert_org_member`
   - `inventory_update_org_member`
   - `inventory_delete_org_member`

Verification performed:
1. Confirmed Qbutton user can see inventory rows; non-member sees zero rows (SQL simulation).
2. UI smoke: `/inventory` loads and shows component stock levels.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists inventory_select_org_member on public.inventory;
drop policy if exists inventory_insert_org_member on public.inventory;
drop policy if exists inventory_update_org_member on public.inventory;
drop policy if exists inventory_delete_org_member on public.inventory;
create policy "Allow anon read inventory"
on public.inventory for select to anon using (true);
create policy "Allow authenticated read inventory"
on public.inventory for select to authenticated using (true);
create policy "Allow authenticated insert inventory"
on public.inventory for insert to authenticated with check (true);
create policy "Allow authenticated update inventory"
on public.inventory for update to authenticated using (true) with check (true);
create policy "Allow authenticated delete inventory"
on public.inventory for delete to authenticated using (true);
commit;
```

### Step 5.11 (completed on 2026-02-15): `public.product_inventory_transactions`

What changed:
1. Removed broad policy `product_inventory_txn_authenticated_all`.
2. Added org-scoped policies:
   - `product_inventory_transactions_select_org_member`
   - `product_inventory_transactions_insert_org_member`
   - `product_inventory_transactions_update_org_member`
   - `product_inventory_transactions_delete_org_member`

Verification performed:
1. Confirmed Qbutton user can see FG inventory transactions; non-member sees zero rows (SQL simulation).
2. UI smoke: Products → Transactions tab loads.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists product_inventory_transactions_select_org_member on public.product_inventory_transactions;
drop policy if exists product_inventory_transactions_insert_org_member on public.product_inventory_transactions;
drop policy if exists product_inventory_transactions_update_org_member on public.product_inventory_transactions;
drop policy if exists product_inventory_transactions_delete_org_member on public.product_inventory_transactions;
create policy product_inventory_txn_authenticated_all
on public.product_inventory_transactions
for all
to authenticated
using (true)
with check (true);
commit;
```

### Step 5.12 (completed on 2026-02-15): `public.components`

What changed:
1. Removed permissive legacy policies (including `Read and Write Auth Users`).
2. Added org-scoped policies:
   - `components_select_org_member`
   - `components_insert_org_member`
   - `components_update_org_member`
   - `components_delete_org_member`

Verification performed:
1. Confirmed Qbutton user can see components; non-member sees zero rows (SQL simulation).
2. UI smoke: `/inventory` continues to load and display components.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists components_select_org_member on public.components;
drop policy if exists components_insert_org_member on public.components;
drop policy if exists components_update_org_member on public.components;
drop policy if exists components_delete_org_member on public.components;
create policy authenticated_users_all_access
on public.components
for all
to public
using (auth.role() = 'authenticated'::text)
with check (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.13 (completed on 2026-02-20): `public.suppliers`

What changed:
1. Removed broad policy `authenticated_users_all_access`.
2. Added org-scoped policies:
   - `suppliers_select_org_member`
   - `suppliers_insert_org_member`
   - `suppliers_update_org_member`
   - `suppliers_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step13_suppliers_replace_broad_with_org`.
2. Confirmed only `suppliers_*_org_member` policies exist on `public.suppliers`.
3. Confirmed `suppliers.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/suppliers` and `/purchasing` with no access errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists suppliers_select_org_member on public.suppliers;
drop policy if exists suppliers_insert_org_member on public.suppliers;
drop policy if exists suppliers_update_org_member on public.suppliers;
drop policy if exists suppliers_delete_org_member on public.suppliers;
create policy authenticated_users_all_access
on public.suppliers
for all
to public
using (auth.role() = 'authenticated'::text)
with check (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.14 (completed on 2026-02-21): `public.purchase_orders`

What changed:
1. Removed broad permissive purchase-order policies:
   - `Authenticated users can select from purchase_orders`
   - `Authenticated users can insert into purchase_orders`
   - `Authenticated users can update purchase_orders`
   - `Authenticated users can delete from purchase_orders`
2. Added org-scoped policies:
   - `purchase_orders_select_org_member`
   - `purchase_orders_insert_org_member`
   - `purchase_orders_update_org_member`
   - `purchase_orders_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step14_purchase_orders_replace_broad_with_org`.
2. Confirmed only `purchase_orders_*_org_member` policies exist on `public.purchase_orders`.
3. Confirmed `purchase_orders.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/purchasing` and `/purchasing/purchase-orders` with no access errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists purchase_orders_select_org_member on public.purchase_orders;
drop policy if exists purchase_orders_insert_org_member on public.purchase_orders;
drop policy if exists purchase_orders_update_org_member on public.purchase_orders;
drop policy if exists purchase_orders_delete_org_member on public.purchase_orders;
create policy "Authenticated users can select from purchase_orders"
on public.purchase_orders for select to authenticated using (true);
create policy "Authenticated users can insert into purchase_orders"
on public.purchase_orders for insert to authenticated with check (true);
create policy "Authenticated users can update purchase_orders"
on public.purchase_orders for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete from purchase_orders"
on public.purchase_orders for delete to authenticated using (true);
commit;
```

### Step 5.15 (completed on 2026-02-21): `public.supplier_orders`

What changed:
1. Removed broad permissive policy:
   - `Allow authenticated users full access`
2. Added org-scoped policies:
   - `supplier_orders_select_org_member`
   - `supplier_orders_insert_org_member`
   - `supplier_orders_update_org_member`
   - `supplier_orders_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step15_supplier_orders_replace_broad_with_org`.
2. Confirmed only `supplier_orders_*_org_member` policies exist on `public.supplier_orders`.
3. Confirmed `supplier_orders.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/purchasing`, `/purchasing/purchase-orders`, and PO details with no access errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists supplier_orders_select_org_member on public.supplier_orders;
drop policy if exists supplier_orders_insert_org_member on public.supplier_orders;
drop policy if exists supplier_orders_update_org_member on public.supplier_orders;
drop policy if exists supplier_orders_delete_org_member on public.supplier_orders;
create policy "Allow authenticated users full access"
on public.supplier_orders
for all
to authenticated
using (true)
with check (true);
commit;
```

### Step 5.16 (completed on 2026-02-21): `public.suppliercomponents`

What changed:
1. Removed broad permissive policy:
   - `authenticated_users_all_access`
2. Added org-scoped policies:
   - `suppliercomponents_select_org_member`
   - `suppliercomponents_insert_org_member`
   - `suppliercomponents_update_org_member`
   - `suppliercomponents_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step16_suppliercomponents_replace_broad_with_org`.
2. Confirmed only `suppliercomponents_*_org_member` policies exist on `public.suppliercomponents`.
3. Confirmed `suppliercomponents.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/purchasing`, `/purchasing/purchase-orders`, and Bulk Receive modal with no access errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists suppliercomponents_select_org_member on public.suppliercomponents;
drop policy if exists suppliercomponents_insert_org_member on public.suppliercomponents;
drop policy if exists suppliercomponents_update_org_member on public.suppliercomponents;
drop policy if exists suppliercomponents_delete_org_member on public.suppliercomponents;
create policy authenticated_users_all_access
on public.suppliercomponents
for all
to public
using (auth.role() = 'authenticated'::text)
with check (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.17 (completed on 2026-02-21): `public.supplier_order_returns`

What changed:
1. Removed broad permissive policies:
   - `Authenticated users can select from supplier_order_returns`
   - `Authenticated users can insert into supplier_order_returns`
   - `Authenticated users can update supplier_order_returns`
   - `Authenticated users can delete from supplier_order_returns`
2. Added org-scoped policies:
   - `supplier_order_returns_select_org_member`
   - `supplier_order_returns_insert_org_member`
   - `supplier_order_returns_update_org_member`
   - `supplier_order_returns_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step17_supplier_order_returns_replace_broad_with_org`.
2. Confirmed only `supplier_order_returns_*_org_member` policies exist on `public.supplier_order_returns`.
3. Confirmed `supplier_order_returns.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/purchasing`, `/purchasing/purchase-orders`, PO details, and Bulk Receive modal with no access errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists supplier_order_returns_select_org_member on public.supplier_order_returns;
drop policy if exists supplier_order_returns_insert_org_member on public.supplier_order_returns;
drop policy if exists supplier_order_returns_update_org_member on public.supplier_order_returns;
drop policy if exists supplier_order_returns_delete_org_member on public.supplier_order_returns;
create policy "Authenticated users can select from supplier_order_returns"
on public.supplier_order_returns for select to authenticated using (true);
create policy "Authenticated users can insert into supplier_order_returns"
on public.supplier_order_returns for insert to authenticated with check (true);
create policy "Authenticated users can update supplier_order_returns"
on public.supplier_order_returns for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete from supplier_order_returns"
on public.supplier_order_returns for delete to authenticated using (true);
commit;
```

### Step 5.18 (completed on 2026-02-21): `public.supplier_order_receipts`

What changed:
1. Removed broad permissive policies:
   - `Authenticated users can select from supplier_order_receipts`
   - `Authenticated users can insert into supplier_order_receipts`
   - `Authenticated users can update supplier_order_receipts`
   - `Authenticated users can delete from supplier_order_receipts`
2. Added org-scoped policies:
   - `supplier_order_receipts_select_org_member`
   - `supplier_order_receipts_insert_org_member`
   - `supplier_order_receipts_update_org_member`
   - `supplier_order_receipts_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step18_supplier_order_receipts_replace_broad_with_org`.
2. Confirmed only `supplier_order_receipts_*_org_member` policies exist on `public.supplier_order_receipts`.
3. Confirmed `supplier_order_receipts.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/purchasing`, `/purchasing/purchase-orders`, and PO details with no access errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists supplier_order_receipts_select_org_member on public.supplier_order_receipts;
drop policy if exists supplier_order_receipts_insert_org_member on public.supplier_order_receipts;
drop policy if exists supplier_order_receipts_update_org_member on public.supplier_order_receipts;
drop policy if exists supplier_order_receipts_delete_org_member on public.supplier_order_receipts;
create policy "Authenticated users can select from supplier_order_receipts"
on public.supplier_order_receipts for select to authenticated using (true);
create policy "Authenticated users can insert into supplier_order_receipts"
on public.supplier_order_receipts for insert to authenticated with check (true);
create policy "Authenticated users can update supplier_order_receipts"
on public.supplier_order_receipts for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete from supplier_order_receipts"
on public.supplier_order_receipts for delete to authenticated using (true);
commit;
```

### Step 5.19 (completed on 2026-02-21): `public.purchase_order_attachments`

What changed:
1. Removed broad permissive policy:
   - `Allow all for authenticated`
2. Added org-scoped policies:
   - `purchase_order_attachments_select_org_member`
   - `purchase_order_attachments_insert_org_member`
   - `purchase_order_attachments_update_org_member`
   - `purchase_order_attachments_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step19_purchase_order_attachments_replace_broad_with_org`.
2. Confirmed only `purchase_order_attachments_*_org_member` policies exist on `public.purchase_order_attachments`.
3. Confirmed `purchase_order_attachments.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on PO detail page; Attachments section loaded with no access/runtime errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists purchase_order_attachments_select_org_member on public.purchase_order_attachments;
drop policy if exists purchase_order_attachments_insert_org_member on public.purchase_order_attachments;
drop policy if exists purchase_order_attachments_update_org_member on public.purchase_order_attachments;
drop policy if exists purchase_order_attachments_delete_org_member on public.purchase_order_attachments;
create policy "Allow all for authenticated"
on public.purchase_order_attachments
for all
to authenticated
using (true)
with check (true);
commit;
```

### Step 5.20 (completed on 2026-02-21): `public.purchase_order_emails`

What changed:
1. Removed broad permissive policies:
   - `Allow authenticated users to view purchase order emails`
   - `Allow authenticated users to insert purchase order emails`
2. Added org-scoped policies (preserving existing command coverage):
   - `purchase_order_emails_select_org_member` (SELECT)
   - `purchase_order_emails_insert_org_member` (INSERT)

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step20_purchase_order_emails_replace_broad_with_org`.
2. Confirmed only `purchase_order_emails_*_org_member` policies exist on `public.purchase_order_emails`.
3. Confirmed `purchase_order_emails.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on PO detail page by opening Email Activity; no access/runtime errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists purchase_order_emails_select_org_member on public.purchase_order_emails;
drop policy if exists purchase_order_emails_insert_org_member on public.purchase_order_emails;
create policy "Allow authenticated users to view purchase order emails"
on public.purchase_order_emails for select to authenticated using (true);
create policy "Allow authenticated users to insert purchase order emails"
on public.purchase_order_emails for insert to authenticated with check (true);
commit;
```

### Step 5.21 (completed on 2026-02-21): `public.quotes`

What changed:
1. Removed broad permissive policy:
   - `allow_all_on_quotes`
2. Added org-scoped policies:
   - `quotes_select_org_member`
   - `quotes_insert_org_member`
   - `quotes_update_org_member`
   - `quotes_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step21_quotes_replace_broad_with_org`.
2. Confirmed only `quotes_*_org_member` policies exist on `public.quotes`.
3. Confirmed `quotes.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/quotes`; no access/runtime errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists quotes_select_org_member on public.quotes;
drop policy if exists quotes_insert_org_member on public.quotes;
drop policy if exists quotes_update_org_member on public.quotes;
drop policy if exists quotes_delete_org_member on public.quotes;
create policy allow_all_on_quotes
on public.quotes
for all
to authenticated
using (true)
with check (true);
commit;
```

### Step 5.22 (completed on 2026-02-21): `public.quote_items`

What changed:
1. Removed broad permissive policies (including duplicate legacy policies):
   - `allow_all_on_quote_items`
   - `Open select quote_items`
   - `Open insert quote_items`
   - `Open update quote_items`
   - `Open delete quote_items`
2. Added org-scoped policies:
   - `quote_items_select_org_member`
   - `quote_items_insert_org_member`
   - `quote_items_update_org_member`
   - `quote_items_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step22_quote_items_replace_broad_with_org`.
2. Confirmed only `quote_items_*_org_member` policies exist on `public.quote_items`.
3. Confirmed `quote_items.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/quotes` list and quote detail page with no access/runtime errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists quote_items_select_org_member on public.quote_items;
drop policy if exists quote_items_insert_org_member on public.quote_items;
drop policy if exists quote_items_update_org_member on public.quote_items;
drop policy if exists quote_items_delete_org_member on public.quote_items;
create policy allow_all_on_quote_items
on public.quote_items
for all
to authenticated
using (true)
with check (true);
commit;
```

### Step 5.23 (completed on 2026-02-21): `public.quote_attachments`

What changed:
1. Removed broad permissive policy:
   - `allow_all_on_quote_attachments`
2. Added org-scoped policies:
   - `quote_attachments_select_org_member`
   - `quote_attachments_insert_org_member`
   - `quote_attachments_update_org_member`
   - `quote_attachments_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step23_quote_attachments_replace_broad_with_org`.
2. Confirmed only `quote_attachments_*_org_member` policies exist on `public.quote_attachments`.
3. Confirmed `quote_attachments.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on quote detail page with no access/runtime errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists quote_attachments_select_org_member on public.quote_attachments;
drop policy if exists quote_attachments_insert_org_member on public.quote_attachments;
drop policy if exists quote_attachments_update_org_member on public.quote_attachments;
drop policy if exists quote_attachments_delete_org_member on public.quote_attachments;
create policy allow_all_on_quote_attachments
on public.quote_attachments
for all
to authenticated
using (true)
with check (true);
commit;
```

### Step 5.24 (completed on 2026-02-21): `public.quote_email_log`

What changed:
1. Removed broad permissive policies:
   - `Users can view quote email logs`
   - `Users can insert quote email logs`
2. Added org-scoped policies (preserving existing command coverage):
   - `quote_email_log_select_org_member` (SELECT)
   - `quote_email_log_insert_org_member` (INSERT)

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step24_quote_email_log_replace_broad_with_org`.
2. Confirmed only `quote_email_log_*_org_member` policies exist on `public.quote_email_log`.
3. Confirmed `quote_email_log.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on quote detail page with no access/runtime errors.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists quote_email_log_select_org_member on public.quote_email_log;
drop policy if exists quote_email_log_insert_org_member on public.quote_email_log;
create policy "Users can view quote email logs"
on public.quote_email_log for select to authenticated using (auth.role() = 'authenticated'::text);
create policy "Users can insert quote email logs"
on public.quote_email_log for insert to authenticated with check (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.25 (completed on 2026-02-21): `public.staff`

What changed:
1. Removed broad and duplicate policies:
   - `Allow anon read access to staff`
   - `Allow anyone to read staff`
   - `Allow authenticated users to read staff`
   - `Allow authenticated users to insert staff`
   - `Allow authenticated users to update staff`
   - `Allow authenticated users to delete staff`
   - `Only allow admins to update staff`
2. Added org-scoped policies:
   - `staff_select_org_member`
   - `staff_insert_org_member`
   - `staff_update_org_member`
   - `staff_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step25_staff_replace_broad_with_org`.
2. Confirmed only `staff_*_org_member` policies exist on `public.staff`.
3. Confirmed `staff.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/staff`, `/staff/hours`, and `/staff/payroll` with no runtime/access denial failures.
5. Noted existing timekeeping fetch pattern on `/staff/hours` issues expected `406` responses for missing per-staff `time_daily_summary` rows; this is not an RLS denial and did not block page usage.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists staff_select_org_member on public.staff;
drop policy if exists staff_insert_org_member on public.staff;
drop policy if exists staff_update_org_member on public.staff;
drop policy if exists staff_delete_org_member on public.staff;

create policy "Allow authenticated users to read staff"
on public.staff
for select
to authenticated
using (auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to insert staff"
on public.staff
for insert
to authenticated
with check (auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to update staff"
on public.staff
for update
to authenticated
using (auth.role() = 'authenticated'::text)
with check (auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to delete staff"
on public.staff
for delete
to authenticated
using (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.26 (completed on 2026-02-21): `public.staff_hours`

What changed:
1. Removed broad permissive policies:
   - `Allow authenticated users to read staff_hours`
   - `Allow authenticated users to insert staff_hours`
   - `Allow authenticated users to update staff_hours`
   - `Allow authenticated users to delete staff_hours`
2. Added org-scoped policies:
   - `staff_hours_select_org_member`
   - `staff_hours_insert_org_member`
   - `staff_hours_update_org_member`
   - `staff_hours_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step26_staff_hours_replace_broad_with_org`.
2. Confirmed only `staff_hours_*_org_member` policies exist on `public.staff_hours`.
3. Confirmed `staff_hours.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/staff/hours` and `/staff/payroll` with no access denial/runtime crash.
5. Noted existing timekeeping fetch pattern still issues expected `406` responses for missing per-staff `time_daily_summary` rows.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists staff_hours_select_org_member on public.staff_hours;
drop policy if exists staff_hours_insert_org_member on public.staff_hours;
drop policy if exists staff_hours_update_org_member on public.staff_hours;
drop policy if exists staff_hours_delete_org_member on public.staff_hours;

create policy "Allow authenticated users to read staff_hours"
on public.staff_hours
for select
to authenticated
using (auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to insert staff_hours"
on public.staff_hours
for insert
to authenticated
with check (auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to update staff_hours"
on public.staff_hours
for update
to authenticated
using (auth.role() = 'authenticated'::text)
with check (auth.role() = 'authenticated'::text);

create policy "Allow authenticated users to delete staff_hours"
on public.staff_hours
for delete
to authenticated
using (auth.role() = 'authenticated'::text);
commit;
```

### Step 5.27 (completed on 2026-02-21): `public.time_clock_events`

What changed:
1. Removed legacy broad/public/anon-read policies:
   - `Allow anon insert to time_clock_events`
   - `Allow anon read access to time clock events`
   - `Allow anonymous inserts to time_clock_events`
   - `Allow anonymous reads from time_clock_events`
   - `Allow reading time events`
   - `Allow time clock events recording`
   - plus prior broad authenticated update/delete policies
2. Added org-scoped authenticated policies:
   - `time_clock_events_select_org_member`
   - `time_clock_events_insert_org_member`
   - `time_clock_events_update_org_member`
   - `time_clock_events_delete_org_member`
3. Preserved public clock-in path with restricted anon insert policy:
   - `time_clock_events_insert_anon_staff_org` (INSERT to `anon` only, requires matching `staff.staff_id` + `staff.org_id`)

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step27_time_clock_events_split_anon_and_org`.
2. Confirmed `public.time_clock_events` policy set is now:
   - 4 org-scoped authenticated policies
   - 1 anon insert-only policy
3. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/staff/hours` with no access/runtime denial.
4. Confirmed expected `406` responses for missing per-staff daily summary rows still occur and are unrelated to this policy change.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists time_clock_events_select_org_member on public.time_clock_events;
drop policy if exists time_clock_events_insert_org_member on public.time_clock_events;
drop policy if exists time_clock_events_update_org_member on public.time_clock_events;
drop policy if exists time_clock_events_delete_org_member on public.time_clock_events;
drop policy if exists time_clock_events_insert_anon_staff_org on public.time_clock_events;

create policy "Allow reading time events"
on public.time_clock_events
for select
to public
using (true);

create policy "Allow time clock events recording"
on public.time_clock_events
for insert
to public
with check (true);

create policy "Allow authenticated users to update time clock events"
on public.time_clock_events
for update
to authenticated
using (true)
with check (true);

create policy "Allow authenticated users to delete time clock events"
on public.time_clock_events
for delete
to authenticated
using (true);
commit;
```

### Step 5.28 (completed on 2026-02-21): `public.time_segments`

What changed:
1. Removed legacy broad/anon policies:
   - `Allow anonymous inserts to time_segments`
   - `Allow anonymous reads from time_segments`
   - `Allow authenticated users to select from time_segments`
   - `Allow authenticated users to insert into time_segments`
   - `Allow authenticated users to update time_segments`
   - `Allow authenticated users to delete from time_segments`
2. Added org-scoped authenticated policies:
   - `time_segments_select_org_member`
   - `time_segments_insert_org_member`
   - `time_segments_update_org_member`
   - `time_segments_delete_org_member`
3. Insert/update safeguards now require `staff.org_id = time_segments.org_id` (prevents cross-org staff linkage through direct writes).

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step28_time_segments_replace_broad_with_org`.
2. Confirmed only `time_segments_*_org_member` policies exist on `public.time_segments`.
3. Confirmed `time_segments.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/staff/hours` with no access/runtime denial.
5. Confirmed expected `406` responses for missing per-staff daily summary rows still occur and are unrelated to this policy change.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists time_segments_select_org_member on public.time_segments;
drop policy if exists time_segments_insert_org_member on public.time_segments;
drop policy if exists time_segments_update_org_member on public.time_segments;
drop policy if exists time_segments_delete_org_member on public.time_segments;

create policy "Allow authenticated users to select from time_segments"
on public.time_segments
for select
to authenticated
using (true);

create policy "Allow authenticated users to insert into time_segments"
on public.time_segments
for insert
to authenticated
with check (true);

create policy "Allow authenticated users to update time_segments"
on public.time_segments
for update
to authenticated
using (true)
with check (true);

create policy "Allow authenticated users to delete from time_segments"
on public.time_segments
for delete
to authenticated
using (true);
commit;
```

### Step 5.29 (completed on 2026-02-21): `public.time_daily_summary`

What changed:
1. Removed legacy broad/anon policies:
   - `Allow anonymous inserts to time_daily_summary`
   - `Allow anonymous reads from time_daily_summary`
   - `Allow anonymous updates to time_daily_summary`
   - `Allow authenticated users to delete from time_daily_summary`
   - `Allow authenticated users to insert into time_daily_summary`
   - `Allow authenticated users to insert time_daily_summary`
   - `Allow authenticated users to select from time_daily_summary`
   - `Allow authenticated users to select their own time_daily_summar`
   - `Allow authenticated users to update their own time_daily_summar`
   - `Allow authenticated users to update time_daily_summary`
2. Added org-scoped authenticated policies:
   - `time_daily_summary_select_org_member`
   - `time_daily_summary_insert_org_member`
   - `time_daily_summary_update_org_member`
   - `time_daily_summary_delete_org_member`
3. Insert/update safeguards now require `staff.org_id = time_daily_summary.org_id` (prevents cross-org staff linkage through direct writes).

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step29_time_daily_summary_replace_broad_with_org`.
2. Confirmed only `time_daily_summary_*_org_member` policies exist on `public.time_daily_summary`.
3. Confirmed `time_daily_summary.org_id` null count is zero.
4. Smoke-tested as a normal user (`testai@qbutton.co.za`) on `/staff/hours` with no access/runtime denial.
5. Confirmed expected `406` responses for missing per-staff daily summary rows still occur and are unrelated to this policy change.

Immediate rollback SQL (if needed):
```sql
begin;
drop policy if exists time_daily_summary_select_org_member on public.time_daily_summary;
drop policy if exists time_daily_summary_insert_org_member on public.time_daily_summary;
drop policy if exists time_daily_summary_update_org_member on public.time_daily_summary;
drop policy if exists time_daily_summary_delete_org_member on public.time_daily_summary;

create policy "Allow authenticated users to select from time_daily_summary"
on public.time_daily_summary
for select
to authenticated
using (true);

create policy "Allow authenticated users to insert into time_daily_summary"
on public.time_daily_summary
for insert
to authenticated
with check (true);

create policy "Allow authenticated users to update time_daily_summary"
on public.time_daily_summary
for update
to authenticated
using (true)
with check (true);

create policy "Allow authenticated users to delete from time_daily_summary"
on public.time_daily_summary
for delete
to authenticated
using (true);

create policy "Allow anonymous inserts to time_daily_summary"
on public.time_daily_summary
for insert
to anon
with check (true);

create policy "Allow anonymous reads from time_daily_summary"
on public.time_daily_summary
for select
to anon
using (true);

create policy "Allow anonymous updates to time_daily_summary"
on public.time_daily_summary
for update
to anon
using (true)
with check (true);
commit;
```

### Step 5.30 (completed on 2026-02-21): Phase C FK validation

What changed:
1. Validated org foreign keys for the three timekeeping tables:
   - `time_clock_events_org_id_fkey`
   - `time_segments_org_id_fkey`
   - `time_daily_summary_org_id_fkey`
2. This is integrity hardening only; no policy behavior change.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_c_validate_org_fks`.
2. Confirmed all three constraints now show `convalidated = true`.
3. Re-smoke-tested as normal user (`testai@qbutton.co.za`) on `/staff/hours` with no access/runtime denial.
4. Confirmed expected `406` missing-row pattern for per-staff daily summary reads remains unchanged.

Immediate rollback note:
- Constraint validation itself is metadata hardening and does not alter data. If a rollback is required, focus on policy rollback steps from 5.27-5.29.

### Step 5.31 (completed on 2026-02-21): Phase C `org_id` NOT NULL enforcement

What changed:
1. Enforced `org_id NOT NULL` on:
   - `public.time_clock_events`
   - `public.time_segments`
   - `public.time_daily_summary`
2. Applied using safe sequence per table:
   - add `CHECK (org_id is not null) NOT VALID`
   - `VALIDATE CONSTRAINT`
   - `ALTER COLUMN org_id SET NOT NULL`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_c_enforce_org_not_null`.
2. Confirmed all three `org_id` columns now report `is_nullable = NO`.
3. Confirmed new check constraints are validated:
   - `time_clock_events_org_id_not_null`
   - `time_segments_org_id_not_null`
   - `time_daily_summary_org_id_not_null`
4. Re-smoke-tested as normal user (`testai@qbutton.co.za`) on `/staff/hours` with no access/runtime denial.
5. Confirmed expected `406` missing-row pattern for per-staff daily summary reads remains unchanged.

Immediate rollback note:
- Reverting `NOT NULL` would require a dedicated rollback migration (`ALTER COLUMN org_id DROP NOT NULL`) and should only be done during incident handling with explicit go/no-go approval.

### Step 5.32 (completed on 2026-02-21): `public.suppliers` constraint enforcement

What changed:
1. Validated `suppliers_org_id_fkey`.
2. Added and validated `CHECK (org_id is not null)` constraint:
   - `suppliers_org_id_not_null`
3. Enforced `suppliers.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step32_suppliers_enforce_org`.
2. Confirmed `suppliers.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated:
   - `suppliers_org_id_fkey`
   - `suppliers_org_id_not_null`
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/suppliers`
   - `/purchasing`
   with no access/runtime denial.

Immediate rollback note:
- If required, rollback must be done via dedicated migration (`ALTER TABLE public.suppliers ALTER COLUMN org_id DROP NOT NULL;` and drop `suppliers_org_id_not_null`) with explicit incident go/no-go approval.

### Step 5.33 (completed on 2026-02-21): `public.purchase_orders` constraint enforcement

What changed:
1. Validated `purchase_orders_org_id_fkey`.
2. Added and validated `CHECK (org_id is not null)` constraint:
   - `purchase_orders_org_id_not_null`
3. Enforced `purchase_orders.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step33_purchase_orders_enforce_org`.
2. Confirmed `purchase_orders.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated:
   - `purchase_orders_org_id_fkey`
   - `purchase_orders_org_id_not_null`
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/purchasing`
   - `/purchasing/purchase-orders/203`
   with no access/runtime denial.

Immediate rollback note:
- If required, rollback must be done via dedicated migration (`ALTER TABLE public.purchase_orders ALTER COLUMN org_id DROP NOT NULL;` and drop `purchase_orders_org_id_not_null`) with explicit incident go/no-go approval.

### Step 5.34 (completed on 2026-02-22): `public.supplier_orders` constraint enforcement

What changed:
1. Validated `supplier_orders_org_id_fkey`.
2. Added and validated `CHECK (org_id is not null)` constraint:
   - `supplier_orders_org_id_not_null`
3. Enforced `supplier_orders.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step34_supplier_orders_enforce_org`.
2. Confirmed `supplier_orders.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated:
   - `supplier_orders_org_id_fkey`
   - `supplier_orders_org_id_not_null`
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/purchasing`
   - `/purchasing/purchase-orders/203`
   with no access/runtime denial and no failing API requests in the tested flow.

Immediate rollback note:
- If required, rollback must be done via dedicated migration (`ALTER TABLE public.supplier_orders ALTER COLUMN org_id DROP NOT NULL;` and drop `supplier_orders_org_id_not_null`) with explicit incident go/no-go approval.

### Step 5.35 (completed on 2026-02-22): `public.suppliercomponents` constraint enforcement

What changed:
1. Validated `suppliercomponents_org_id_fkey`.
2. Added and validated `CHECK (org_id is not null)` constraint:
   - `suppliercomponents_org_id_not_null`
3. Enforced `suppliercomponents.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step35_suppliercomponents_enforce_org`.
2. Confirmed `suppliercomponents.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated:
   - `suppliercomponents_org_id_fkey`
   - `suppliercomponents_org_id_not_null`
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/purchasing`
   - `/purchasing/purchase-orders/203`
   with no access/runtime denial.

Immediate rollback note:
- If required, rollback must be done via dedicated migration (`ALTER TABLE public.suppliercomponents ALTER COLUMN org_id DROP NOT NULL;` and drop `suppliercomponents_org_id_not_null`) with explicit incident go/no-go approval.

### Step 5.36 (completed on 2026-02-22): `public.supplier_order_returns` constraint enforcement

What changed:
1. Validated `supplier_order_returns_org_id_fkey`.
2. Added and validated `CHECK (org_id is not null)` constraint:
   - `supplier_order_returns_org_id_not_null`
3. Enforced `supplier_order_returns.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step36_supplier_order_returns_enforce_org`.
2. Confirmed `supplier_order_returns.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated:
   - `supplier_order_returns_org_id_fkey`
   - `supplier_order_returns_org_id_not_null`
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/purchasing`
   - `/purchasing/purchase-orders/203`
   with no access/runtime denial and no console errors in the tested flow.

Immediate rollback note:
- If required, rollback must be done via dedicated migration (`ALTER TABLE public.supplier_order_returns ALTER COLUMN org_id DROP NOT NULL;` and drop `supplier_order_returns_org_id_not_null`) with explicit incident go/no-go approval.

### Step 5.37 (completed on 2026-02-22): `public.supplier_order_receipts` constraint enforcement

What changed:
1. Validated `supplier_order_receipts_org_id_fkey`.
2. Added and validated `CHECK (org_id is not null)` constraint:
   - `supplier_order_receipts_org_id_not_null`
3. Enforced `supplier_order_receipts.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step37_supplier_order_receipts_enforce_org`.
2. Confirmed `supplier_order_receipts.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated:
   - `supplier_order_receipts_org_id_fkey`
   - `supplier_order_receipts_org_id_not_null`
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/purchasing`
   - `/purchasing/purchase-orders/203`
   with no access/runtime denial and no console errors in the tested flow.

Immediate rollback note:
- If required, rollback must be done via dedicated migration (`ALTER TABLE public.supplier_order_receipts ALTER COLUMN org_id DROP NOT NULL;` and drop `supplier_order_receipts_org_id_not_null`) with explicit incident go/no-go approval.

### Step 5.38 (completed on 2026-02-22): `public.purchase_order_attachments` constraint enforcement

What changed:
1. Validated `purchase_order_attachments_org_id_fkey`.
2. Added and validated `purchase_order_attachments_org_id_not_null`.
3. Enforced `purchase_order_attachments.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step38_purchase_order_attachments_enforce_org`.
2. Confirmed `purchase_order_attachments.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/purchasing/purchase-orders/203` with no access/runtime denial.

### Step 5.39 (completed on 2026-02-22): `public.purchase_order_emails` constraint enforcement

What changed:
1. Validated `purchase_order_emails_org_id_fkey`.
2. Added and validated `purchase_order_emails_org_id_not_null`.
3. Enforced `purchase_order_emails.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step39_purchase_order_emails_enforce_org`.
2. Confirmed `purchase_order_emails.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/purchasing/purchase-orders/203` with no access/runtime denial.

### Step 5.40 (completed on 2026-02-22): `public.quotes` constraint enforcement

What changed:
1. Validated `quotes_org_id_fkey`.
2. Added and validated `quotes_org_id_not_null`.
3. Enforced `quotes.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step40_quotes_enforce_org`.
2. Confirmed `quotes.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Smoke-tested quote list and detail APIs (`/quotes`, `/quotes/<id>`) with no failing API responses.

### Step 5.41 (completed on 2026-02-22): `public.quote_items` constraint enforcement

What changed:
1. Validated `quote_items_org_id_fkey`.
2. Added and validated `quote_items_org_id_not_null`.
3. Enforced `quote_items.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step41_quote_items_enforce_org`.
2. Confirmed `quote_items.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Re-smoke-tested quote detail API (`/api/quotes/<id>`) successfully.

### Step 5.42 (completed on 2026-02-22): `public.quote_attachments` constraint enforcement

What changed:
1. Validated `quote_attachments_org_id_fkey`.
2. Added and validated `quote_attachments_org_id_not_null`.
3. Enforced `quote_attachments.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step42_quote_attachments_enforce_org`.
2. Confirmed `quote_attachments.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Re-smoke-tested quote detail + attachments read path successfully.

### Step 5.43 (completed on 2026-02-22): `public.quote_email_log` constraint enforcement

What changed:
1. Validated `quote_email_log_org_id_fkey`.
2. Added and validated `quote_email_log_org_id_not_null`.
3. Enforced `quote_email_log.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step43_quote_email_log_enforce_org`.
2. Confirmed `quote_email_log.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Re-smoke-tested quote detail + email-status path successfully.

### Step 5.44 (completed on 2026-02-22): `public.staff` constraint enforcement

What changed:
1. Validated `staff_org_id_fkey`.
2. Added and validated `staff_org_id_not_null`.
3. Enforced `staff.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step44_staff_enforce_org`.
2. Confirmed `staff.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Smoke-tested `/staff/hours` as normal user (`testai@qbutton.co.za`): page loads and behavior unchanged; expected `406` per-staff missing `time_daily_summary` rows still appear as known pre-existing pattern.

### Step 5.45 (completed on 2026-02-22): `public.staff_hours` constraint enforcement

What changed:
1. Validated `staff_hours_org_id_fkey`.
2. Added and validated `staff_hours_org_id_not_null`.
3. Enforced `staff_hours.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step45_staff_hours_enforce_org`.
2. Confirmed `staff_hours.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Re-smoke-tested `/staff/hours` as normal user (`testai@qbutton.co.za`): no new access/runtime denial introduced; same known `406` missing-summary pattern remains.

### Step 5.46 (completed on 2026-02-22): `public.product_cutlist_groups` constraint enforcement

What changed:
1. Validated `product_cutlist_groups_org_id_fkey`.
2. Added and validated `product_cutlist_groups_org_id_not_null`.
3. Enforced `product_cutlist_groups.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step46_product_cutlist_groups_enforce_org`.
2. Confirmed `product_cutlist_groups.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Precheck verified zero `org_id` null rows and zero `org_id` mismatch rows against `products.org_id`.

### Step 5.47 (completed on 2026-02-22): `public.product_cutlist_groups` org-scoped RLS

What changed:
1. Removed broad authenticated policies:
   - `Allow authenticated users to view cutlist groups`
   - `Allow authenticated users to insert cutlist groups`
   - `Allow authenticated users to update cutlist groups`
   - `Allow authenticated users to delete cutlist groups`
2. Added org-scoped authenticated policies:
   - `product_cutlist_groups_select_org_member`
   - `product_cutlist_groups_insert_org_member`
   - `product_cutlist_groups_update_org_member`
   - `product_cutlist_groups_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step47_product_cutlist_groups_replace_broad_with_org`.
2. Confirmed only org-scoped policies remain for `public.product_cutlist_groups`.
3. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/products/812/cutlist-builder`:
   - `/api/products/812/cutlist-groups?module=cutlist_optimizer` returned `200`.
   - Cutlist builder loaded existing groups successfully.
   - No new cutlist access/runtime regression introduced.
4. Observed unchanged pre-existing `406` reads on `cutlist_material_defaults` for absent per-user rows (known pattern, unrelated to `product_cutlist_groups` RLS).

### Step 5.48 (completed on 2026-02-22): `public.supplier_pricelists` constraint enforcement

What changed:
1. Validated `supplier_pricelists_org_id_fkey`.
2. Added and validated `supplier_pricelists_org_id_not_null`.
3. Enforced `supplier_pricelists.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step48_supplier_pricelists_enforce_org`.
2. Confirmed `supplier_pricelists.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Precheck verified zero `org_id` null rows in `supplier_pricelists`.

### Step 5.49 (completed on 2026-02-22): `public.supplier_pricelists` org-scoped RLS

What changed:
1. Removed broad authenticated policy:
   - `Authenticated users read and write.`
2. Added org-scoped authenticated policies:
   - `supplier_pricelists_select_org_member`
   - `supplier_pricelists_insert_org_member`
   - `supplier_pricelists_update_org_member`
   - `supplier_pricelists_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step49_supplier_pricelists_replace_broad_with_org`.
2. Confirmed only org-scoped policies remain for `public.supplier_pricelists`.
3. Re-ran broad-policy audit across all `public` tables with `org_id`; result is now empty.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/suppliers`:
   - Suppliers list loaded successfully.
   - Nested `pricelists:supplier_pricelists(*)` read returned `200`.
   - No new access/runtime regression introduced.

### Step 5.50 (completed on 2026-02-22): `public.quote_company_settings` constraint enforcement

What changed:
1. Validated `quote_company_settings_org_id_fkey`.
2. Added and validated `quote_company_settings_org_id_not_null`.
3. Enforced `quote_company_settings.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step50_quote_company_settings_enforce_org`.
2. Confirmed `quote_company_settings.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Precheck verified zero `org_id` null rows in `quote_company_settings`.

### Step 5.51 (completed on 2026-02-22): `public.quote_company_settings` org-scoped RLS

What changed:
1. Enabled RLS on `public.quote_company_settings`.
2. Added org-scoped authenticated policies:
   - `quote_company_settings_select_org_member`
   - `quote_company_settings_insert_org_member`
   - `quote_company_settings_update_org_member`
   - `quote_company_settings_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step51_quote_company_settings_enable_org`.
2. Confirmed `relrowsecurity = true` for `public.quote_company_settings`.
3. Confirmed org-scoped policies are present for select/insert/update/delete.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/settings`, `/quotes`, and `/purchasing`; no new access/runtime regression introduced.

### Step 5.52 (completed on 2026-02-22): `public.purchase_order_activity` constraint enforcement

What changed:
1. Verified no `org_id` null rows remain.
2. Enforced `purchase_order_activity.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step52_purchase_order_activity_enforce_org`.
2. Confirmed `purchase_order_activity.org_id` now reports `is_nullable = NO`.
3. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/purchasing`, `/purchasing/purchase-orders`, and `/purchasing/purchase-orders/142`; no new access/runtime regression introduced.

### Step 5.53 (completed on 2026-02-22): `public.supplier_emails` constraint enforcement

What changed:
1. Validated `supplier_emails_org_id_fkey`.
2. Added and validated `supplier_emails_org_id_not_null`.
3. Enforced `supplier_emails.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step53_supplier_emails_enforce_org`.
2. Confirmed `supplier_emails.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Precheck verified zero `org_id` null rows in `supplier_emails`.

### Step 5.54 (completed on 2026-02-22): `public.supplier_emails` org-scoped RLS

What changed:
1. Removed broad authenticated policy:
   - `authenticated_users_all_access`
2. Added org-scoped authenticated policies:
   - `supplier_emails_select_org_member`
   - `supplier_emails_insert_org_member`
   - `supplier_emails_update_org_member`
   - `supplier_emails_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step54_supplier_emails_replace_broad_with_org`.
2. Confirmed only org-scoped policies remain for `public.supplier_emails`.
3. Smoke-tested as normal user (`testai@qbutton.co.za`) on:
   - `/suppliers` (`suppliers?select=...,emails:supplier_emails(*)` returned `200`)
   - `/purchasing/purchase-orders/142` (nested `supplier_emails` read returned `200`)
4. No new access/runtime regression introduced.

### Step 5.55 (completed on 2026-02-22): `public.staff_weekly_hours` constraint enforcement

What changed:
1. Validated `staff_weekly_hours_org_id_fkey`.
2. Added and validated `staff_weekly_hours_org_id_not_null`.
3. Enforced `staff_weekly_hours.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step55_staff_weekly_hours_enforce_org`.
2. Confirmed `staff_weekly_hours.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/staff/hours` and `/staff/payroll`; no new access/runtime regression introduced.

### Step 5.56 (completed on 2026-02-22): `public.staff_weekly_payroll` constraint enforcement

What changed:
1. Validated `staff_weekly_payroll_org_id_fkey`.
2. Added and validated `staff_weekly_payroll_org_id_not_null`.
3. Enforced `staff_weekly_payroll.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step56_staff_weekly_payroll_enforce_org`.
2. Confirmed `staff_weekly_payroll.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/staff/payroll` and `/staff/hours`; no new access/runtime regression introduced.

### Step 5.57 (completed on 2026-02-22): `public.supplier_follow_up_responses` constraint enforcement

What changed:
1. Validated `supplier_follow_up_responses_org_id_fkey`.
2. Added and validated `supplier_follow_up_responses_org_id_not_null`.
3. Enforced `supplier_follow_up_responses.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step57_supplier_follow_up_responses_enforce_org`.
2. Confirmed `supplier_follow_up_responses.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Precheck verified zero `org_id` null rows before enforcement.

### Step 5.58 (completed on 2026-02-22): `public.supplier_follow_up_responses` org-scoped RLS

What changed:
1. Removed broad policy:
   - `Allow all access to supplier_responses`
2. Added org-scoped authenticated policies:
   - `supplier_follow_up_responses_select_org_member`
   - `supplier_follow_up_responses_insert_org_member`
   - `supplier_follow_up_responses_update_org_member`
   - `supplier_follow_up_responses_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step58_supplier_follow_up_responses_replace_broad_with_org`.
2. Confirmed only org-scoped policies remain for `public.supplier_follow_up_responses`.
3. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/purchasing`, `/purchasing/purchase-orders/142`, and `/suppliers`; no new access/runtime regression introduced.

### Step 5.59 (completed on 2026-02-22): `public.supplier_order_customer_orders` constraint enforcement

What changed:
1. Validated `supplier_order_customer_orders_org_id_fkey`.
2. Added and validated `supplier_order_customer_orders_org_id_not_null`.
3. Enforced `supplier_order_customer_orders.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step59_supplier_order_customer_orders_enforce_org`.
2. Confirmed `supplier_order_customer_orders.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.
4. Precheck verified zero `org_id` null rows before enforcement.

### Step 5.60 (completed on 2026-02-22): `public.supplier_order_customer_orders` org-scoped RLS

What changed:
1. Enabled RLS on `public.supplier_order_customer_orders`.
2. Added org-scoped authenticated policies:
   - `supplier_order_customer_orders_select_org_member`
   - `supplier_order_customer_orders_insert_org_member`
   - `supplier_order_customer_orders_update_org_member`
   - `supplier_order_customer_orders_delete_org_member`

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step60_supplier_order_customer_orders_enable_org`.
2. Confirmed `relrowsecurity = true` for `public.supplier_order_customer_orders`.
3. Confirmed org-scoped policies are present for select/insert/update/delete.
4. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/purchasing/purchase-orders/142` and `/purchasing`; nested `customer_order_links:supplier_order_customer_orders(...)` read returned `200`.

### Step 5.61 (completed on 2026-02-22): `public.quote_cluster_lines` constraint enforcement

What changed:
1. Validated `quote_cluster_lines_org_id_fkey`.
2. Added and validated `quote_cluster_lines_org_id_not_null`.
3. Enforced `quote_cluster_lines.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step61_quote_cluster_lines_enforce_org`.
2. Confirmed `quote_cluster_lines.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.

### Step 5.62 (completed on 2026-02-22): `public.quote_cluster_lines` org-scoped RLS

What changed:
1. Enabled RLS on `public.quote_cluster_lines`.
2. Added org-scoped authenticated policies for select/insert/update/delete.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step62_quote_cluster_lines_enable_org`.
2. Confirmed `relrowsecurity = true` and org-scoped policies are present.

### Step 5.63 (completed on 2026-02-22): `public.quote_item_clusters` constraint enforcement

What changed:
1. Validated `quote_item_clusters_org_id_fkey`.
2. Added and validated `quote_item_clusters_org_id_not_null`.
3. Enforced `quote_item_clusters.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step63_quote_item_clusters_enforce_org`.
2. Confirmed `quote_item_clusters.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.

### Step 5.64 (completed on 2026-02-22): `public.quote_item_clusters` org-scoped RLS

What changed:
1. Enabled RLS on `public.quote_item_clusters`.
2. Added org-scoped authenticated policies for select/insert/update/delete.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step64_quote_item_clusters_enable_org`.
2. Confirmed `relrowsecurity = true` and org-scoped policies are present.

### Step 5.65 (completed on 2026-02-22): `public.quote_item_cutlists` constraint enforcement

What changed:
1. Validated `quote_item_cutlists_org_id_fkey`.
2. Added and validated `quote_item_cutlists_org_id_not_null`.
3. Enforced `quote_item_cutlists.org_id` as `NOT NULL`.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_org_scoping_phase_b_step65_quote_item_cutlists_enforce_org`.
2. Confirmed `quote_item_cutlists.org_id` now reports `is_nullable = NO`.
3. Confirmed both constraints are validated.

### Step 5.66 (completed on 2026-02-22): `public.quote_item_cutlists` org-scoped RLS

What changed:
1. Enabled RLS on `public.quote_item_cutlists`.
2. Added org-scoped authenticated policies for select/insert/update/delete.

Verification performed:
1. Confirmed migration is recorded in `schema_migrations` as `tenant_rls_step66_quote_item_cutlists_enable_org`.
2. Confirmed `relrowsecurity = true` and org-scoped policies are present.
3. Smoke-tested as normal user (`testai@qbutton.co.za`) on `/quotes` and quote detail (`/quotes/ee0f39e9-e1e3-48a2-927f-7390fc3dda46`); no new access/runtime regression introduced.

## Unique constraint strategy (important)

Current constraints like `products_internal_code_key` are globally unique.  
That is safe now, but too strict for future multi-tenant growth.

Recommended later migration (after this runbook):
1. Add tenant-aware unique indexes (for example `(org_id, internal_code)`).
2. Migrate reads/writes.
3. Drop global unique constraints only when validated.

Do not combine this with initial tenant backfill cutover.

---

## Emergency rollback plan

If anything fails after Stage 3 deployment:

1. Disable strict tenancy enforcement flag in app.
2. Re-deploy previous API behavior (no hard org filter).
3. Keep additive columns in place (do not drop during incident).
4. Repair any nulls quickly:
```sql
update public.orders set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.products set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
update public.product_inventory set org_id = 'QBUTTON_ORG_UUID'::uuid where org_id is null;
```
5. If required, restore from backup snapshot.

---

## Final acceptance criteria

1. All critical `orders/products/stock` rows have `org_id`.
2. Parent-child org consistency checks are zero mismatch.
3. Live Qbutton users complete normal workflows with no access regressions.
4. API writes always stamp `org_id` correctly.
5. Ready for onboarding second tenant without cross-tenant data risk.
