# SQL Snippets (apply in Supabase SQL editor)

```sql
-- Organization membership table
create table if not exists public.organization_members (
  user_id uuid references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  role text check (role in ('owner','admin','manager','staff')),
  is_active boolean default true,
  banned_until timestamptz,
  inserted_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  primary key (user_id, org_id)
);

-- Profiles table (if not present)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, -- friendly name shown in UI
  username text, -- legacy compat, mirror of display_name
  first_name text,
  last_name text,
  login text, -- synthetic login handle (username)
  avatar_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Admin audit log
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  action text not null,
  target_user_id uuid references auth.users(id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Helper to keep updated_at fresh
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

-- Helper function to check org membership
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable
security definer set search_path=public
as $$
  select exists(
    select 1 from organization_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > timezone('utc', now()))
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path=public
as $$
  (auth.jwt()->>'role') in ('owner','admin')
$$;

-- Example RLS policy on org-scoped table
-- alter table public.some_table enable row level security;
-- drop policy if exists org_read on public.some_table;
create policy org_read on public.some_table
for select using ( public.is_org_member(org_id) );

-- Admin-only policy example (for a view/table)
-- create policy admin_read on public.admin_view for select using (public.is_admin());

-- Storage bucket for avatars (public read, owner write/delete)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy if not exists "avatar_read_public" on storage.objects
for select using (bucket_id = 'avatars');

create policy if not exists "avatar_upload_own" on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and auth.uid() = owner
  and (string_to_array(name, '/'))[1] = auth.uid()::text
);

create policy if not exists "avatar_update_own" on storage.objects
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

create policy if not exists "avatar_delete_own" on storage.objects
for delete
using (
  bucket_id = 'avatars'
  and auth.uid() = owner
  and (string_to_array(name, '/'))[1] = auth.uid()::text
);
```
