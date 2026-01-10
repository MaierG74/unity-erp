-- Add first and last name fields to profiles for richer display

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

create index if not exists profiles_first_name_idx on public.profiles (first_name);
create index if not exists profiles_last_name_idx on public.profiles (last_name);
