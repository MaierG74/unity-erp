-- Tenant org scoping Step 46 (baby step): product_cutlist_groups constraint enforcement.
-- Safe sequence: validate FK -> add/validate NOT NULL check -> set NOT NULL.

begin;

alter table public.product_cutlist_groups
  validate constraint product_cutlist_groups_org_id_fkey;

alter table public.product_cutlist_groups
  add constraint product_cutlist_groups_org_id_not_null
  check (org_id is not null) not valid;

alter table public.product_cutlist_groups
  validate constraint product_cutlist_groups_org_id_not_null;

alter table public.product_cutlist_groups
  alter column org_id set not null;

commit;
