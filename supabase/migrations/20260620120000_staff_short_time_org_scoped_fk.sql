-- Org-scope the staff_short_time -> staff reference so an org admin cannot create a
-- short-time row referencing another org's staff_id. Whole-factory rows (staff_id NULL)
-- are unaffected: a composite FK with MATCH SIMPLE skips the check when staff_id is NULL.
-- Applied to prod 2026-06-20 (table had 0 rows).
alter table public.staff
  add constraint staff_org_id_staff_id_key unique (org_id, staff_id);

alter table public.staff_short_time
  drop constraint if exists staff_short_time_staff_id_fkey;

alter table public.staff_short_time
  add constraint staff_short_time_staff_org_fkey
    foreign key (org_id, staff_id)
    references public.staff (org_id, staff_id);
