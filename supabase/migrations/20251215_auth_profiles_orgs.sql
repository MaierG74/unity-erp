-- Auth/org foundations: profile fields, org membership, audit log, avatar storage

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Organizations + membership
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','staff')),
  is_active boolean not null default true,
  banned_until timestamptz,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- Simple updated_at trigger
create or replace function public.set_current_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at
before update on public.organization_members
for each row
execute function public.set_current_timestamp();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_current_timestamp();

-- Profile enhancements for login/display names/avatars
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists login text;
alter table public.profiles alter column updated_at set default now();

update public.profiles
set display_name = coalesce(display_name, username)
where display_name is null;

update public.profiles
set username = display_name
where username is null and display_name is not null;

create index if not exists profiles_login_idx on public.profiles (login);
create index if not exists profiles_display_name_idx on public.profiles (display_name);

-- Helper functions used by RLS
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  (auth.jwt()->>'role') in ('owner','admin')
$$;

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.organization_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and coalesce(m.is_active, false) = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  );
$$;

-- Admin audit log
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  action text not null,
  target_user_id uuid references auth.users(id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.organizations enable row level security;
alter table public.admin_audit_log enable row level security;

create policy if not exists "profiles_select_any" on public.profiles
for select using (true);

create policy if not exists "profiles_update_self" on public.profiles
for update using (auth.uid() = id)
with check (auth.uid() = id);

create policy if not exists "profiles_insert_admin" on public.profiles
for insert using (public.is_admin())
with check (public.is_admin());

create policy if not exists "org_members_select_self_or_admin" on public.organization_members
for select using (auth.uid() = user_id or public.is_admin());

create policy if not exists "org_members_update_self_or_admin" on public.organization_members
for update using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

create policy if not exists "orgs_select_admin" on public.organizations
for select using (public.is_admin());

create policy if not exists "orgs_insert_admin" on public.organizations
for insert using (public.is_admin())
with check (public.is_admin());

create policy if not exists "orgs_update_admin" on public.organizations
for update using (public.is_admin())
with check (public.is_admin());

create policy if not exists "admin_audit_read_admin" on public.admin_audit_log
for select using (public.is_admin());

create policy if not exists "admin_audit_insert_admin" on public.admin_audit_log
for insert using (public.is_admin())
with check (public.is_admin());

-- Avatar storage bucket and policies
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar_read_public" on storage.objects;
create policy "avatar_read_public" on storage.objects
for select
using (bucket_id = 'avatars');

drop policy if exists "avatar_upload_own" on storage.objects;
create policy "avatar_upload_own" on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and auth.uid() = owner
  and position(name, '../') = 0
  and (string_to_array(name, '/'))[1] = auth.uid()::text
);

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own" on storage.objects
for update
using (
  bucket_id = 'avatars'
  and auth.uid() = owner
  and (string_to_array(name, '/'))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and auth.uid() = owner
  and (string_to_array(name, '/'))[1] = auth.uid()::text
);

drop policy if exists "avatar_delete_own" on storage.objects;
create policy "avatar_delete_own" on storage.objects
for delete
using (
  bucket_id = 'avatars'
  and auth.uid() = owner
  and (string_to_array(name, '/'))[1] = auth.uid()::text
);
