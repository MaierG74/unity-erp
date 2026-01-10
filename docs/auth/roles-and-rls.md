# Roles, Orgs, and RLS

## Roles (proposed)
- owner
- admin
- manager
- staff

## Org model
- `organizations (id, name, ...)`
- `organization_members (user_id, org_id, role, is_active, banned_until)`
- `profiles (id, display_name, first_name, last_name, login, avatar_url, username alias)`

## JWT/app_metadata usage
- `app_metadata.role`: highest privilege (owner/admin/manager/staff).
- `app_metadata.org_id`: primary org (if single-org per user). For multi-org, rely on `organization_members` in RLS.

## RLS pattern (org-scoped tables)
```sql
create policy "org members read" on some_table
for select using (
  exists (
    select 1 from organization_members m
    where m.user_id = auth.uid()
      and m.org_id = some_table.org_id
      and m.is_active = true
      and (m.banned_until is null or m.banned_until > now())
  )
);
```

## Admin-only actions
- Listing users, creating, resetting passwords, changing roles/org:
  - Check `auth.jwt()->>'role' in ('owner','admin')`.
  - Ensure same org scope unless owner is global.

## Profile data
- `profiles` stores `display_name`, `login` (synthetic handle), `avatar_url`, and keeps `username` in sync for legacy consumers.
- Avatars live in bucket `avatars/{user_id}/...` (public read; owner-only write/delete).

## Feature flags (optional)
- Tables: `feature_flags(id, key, description)`, `feature_grants(id, feature_key, scope_type: 'role'|'org'|'user', scope_value, enabled)`.
- RLS: allow read where user is in org and grant matches user role/org/user.
- Frontend: fetch grants + read `app_metadata.role/org_id`; hide/disable UI accordingly.
