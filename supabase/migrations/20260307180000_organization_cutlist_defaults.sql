-- Add tenant-scoped cutlist defaults for reusable offcut rules.
alter table public.organizations
  add column if not exists cutlist_defaults jsonb;

comment on column public.organizations.cutlist_defaults is
  'Org-level defaults for cutlist behavior such as reusable offcut thresholds.';
