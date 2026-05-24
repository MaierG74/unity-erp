-- Speed up the manual purchase-order component picker for large catalogs.
-- The picker searches active components by code/description, supplier code,
-- supplier name, category, and supplier, always scoped by organization.

create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

create index if not exists components_po_picker_active_code_idx
  on public.components (org_id, internal_code)
  where is_active = true;

create index if not exists components_po_picker_active_category_code_idx
  on public.components (org_id, category_id, internal_code)
  where is_active = true;

create index if not exists components_po_picker_internal_code_trgm_idx
  on public.components
  using gin (internal_code gin_trgm_ops)
  where is_active = true;

create index if not exists components_po_picker_description_trgm_idx
  on public.components
  using gin (description gin_trgm_ops)
  where is_active = true and description is not null;

create index if not exists suppliercomponents_po_picker_supplier_idx
  on public.suppliercomponents (org_id, supplier_id, component_id);

create index if not exists suppliercomponents_po_picker_component_idx
  on public.suppliercomponents (org_id, component_id, supplier_id);

create index if not exists suppliercomponents_po_picker_code_trgm_idx
  on public.suppliercomponents
  using gin (supplier_code gin_trgm_ops)
  where supplier_code is not null;

create index if not exists suppliers_po_picker_name_trgm_idx
  on public.suppliers
  using gin (name gin_trgm_ops)
  where is_active = true and name is not null;
