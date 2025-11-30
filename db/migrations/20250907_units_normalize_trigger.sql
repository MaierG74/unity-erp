-- Normalize units on insert/update: code uppercase; name Title Case
begin;

create or replace function public.normalize_unitsofmeasure()
returns trigger
language plpgsql
as $$
begin
  if new.unit_code is not null then
    new.unit_code := upper(trim(new.unit_code));
  end if;
  if new.unit_name is not null then
    -- initcap lowercases then capitalizes each word by default
    new.unit_name := initcap(trim(new.unit_name));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_unitsofmeasure on public.unitsofmeasure;
create trigger trg_normalize_unitsofmeasure
before insert or update on public.unitsofmeasure
for each row execute function public.normalize_unitsofmeasure();

commit;

