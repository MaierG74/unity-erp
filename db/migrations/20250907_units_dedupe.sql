-- Deduplicate units of measure and enforce case-insensitive uniqueness
-- Safe to run multiple times (idempotent where possible)

begin;

-- 1) Remap component references from duplicate units to canonical ones
-- each: 6 -> 10 (ea -> EA)
update components set unit_id = 10 where unit_id = 6;
-- meter: 12 -> 3 (M -> m)
update components set unit_id = 3 where unit_id = 12;
-- kilogram: 11 -> 1 (KG -> kg)
update components set unit_id = 1 where unit_id = 11;

-- 2) Delete duplicate unit rows if they now have no references
delete from unitsofmeasure where unit_id in (6,12,11)
  and not exists (select 1 from components c where c.unit_id = unitsofmeasure.unit_id);

-- 3) Enforce case-insensitive uniqueness on code and name
create unique index if not exists unitsofmeasure_unit_code_ci_unique
  on public.unitsofmeasure (lower(unit_code));

create unique index if not exists unitsofmeasure_unit_name_ci_unique
  on public.unitsofmeasure (lower(unit_name));

commit;

