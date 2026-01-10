# User Onboarding (Password-Based, Synthetic Emails)

## Goal
Allow admins to create login/password accounts (synthetic emails like `username@qbutton.co.za`) without using the Supabase dashboard or magic links.

## Flows
- Admin create user:
  - Inputs: login (username), password, display_name, first_name, last_name, role, org_id, optional avatar_url.
  - Synthetic email: `${login}@qbutton.co.za`.
  - Call `auth.admin.createUser` with `email_confirm` (or `email_confirmed_at`) set to auto-confirm.
  - Seed `profiles` (user_id, display_name, first_name, last_name, login, avatar_url), `organization_members` (user_id, org_id, role, is_active=true).
  - Return login + password once to admin.

- Admin reset password:
  - Input: user_id, new password.
  - Call `auth.admin.updateUserById` with `password`.
  - Show password once; user logs in with synthetic email + new password.

- Deactivate/reactivate:
  - `auth.admin.updateUserById({ banned_until })` or soft-delete flag in app tables (preferred: `is_active` in `organization_members`).
  - RLS should check both `is_active` and `banned_until > now()` to block access.

- Update profile (admin):
  - `PATCH /api/admin/users/{id}/profile` accepts `display_name`, `first_name`, `last_name`, `login`, optional `avatar_url`.
  - Changing `login` regenerates the synthetic email and updates `app_metadata` + `profiles`.

- Update profile (self-service):
  - Authenticated user can `PATCH /api/me/profile` with `display_name` and `avatar_url`. `login` is immutable to end users.
  - Avatars live in `storage` bucket `avatars`, path prefix `{user_id}/...`, public read, owner write.

## Constraints
- No inbox required; email is just a unique login.
- Self-signup: OFF by default.
- Password policy: (decide) e.g., min 12 chars, mixed case/number/symbol.
- Auditing: log admin actions (create, reset, role change, deactivate).

## Data touched
- Supabase Auth: user row (email, password, app_metadata: { role, org_id }, user_metadata: { display_name, first_name, last_name, avatar_url, login }).
- `profiles`: id PK (auth.users.id), display_name, first_name, last_name, username (mirror), login (synthetic handle), avatar_url.
- `organization_members`: role + org scoping + `is_active`/`banned_until` for enforcement.
