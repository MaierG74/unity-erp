# Admin API for User Lifecycle (server-only, service_role)

## Endpoints (examples)
- POST `/api/admin/users` (create)
  - Body: `{ login, password, display_name, first_name?, last_name?, role, org_id, avatar_url? }`
  - Steps:
    - `email = \`${login}@qbutton.co.za\``
    - `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name, first_name, last_name, avatar_url, login }, app_metadata: { role, org_id } })`
    - Insert into `profiles` (user_id, display_name, first_name, last_name, login, avatar_url)
    - Insert into `organization_members` (user_id, org_id, role, is_active=true)
    - Respond with `{ user_id, login, password }` (password shown once)

- POST `/api/admin/users/{id}/password`
  - Body: `{ new_password }`
  - Calls `auth.admin.updateUserById({ password: new_password })`
  - Responds with the new password once.

- POST `/api/admin/users/{id}/deactivate`
  - Body: `{ is_active: boolean }`
  - Update `organization_members.is_active`; optionally set `banned_until` in Auth.

- POST `/api/admin/users/{id}/role`
  - Body: `{ role, org_id? }`
  - Update `app_metadata.role` and `organization_members`.

- PATCH `/api/admin/users/{id}/profile`
  - Body: `{ display_name?, first_name?, last_name?, login?, avatar_url? }`
  - Changing `login` regenerates the synthetic email; updates Auth and `profiles`.
  - `display_name` keeps `profiles.username` in sync for existing UI consumers.

- GET `/api/admin/orgs`
  - Lists organizations for admin UI dropdowns.

## Security
- Require server auth (e.g., Next.js Route Handler with server-side check).
- Use `service_role` key only on server/Edge Function env.
- Rate-limit admin routes.
- Audit log table: `admin_audit_log (id, actor_user_id, action, target_user_id, metadata, created_at)`.
- Avatar storage: bucket `avatars`, public read, owner-only write/delete under `{user_id}/...`.
