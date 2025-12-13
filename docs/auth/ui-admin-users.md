# Admin UI: Users

## Page
- Table: display name (primary), login (synthetic email), role, org, status (active/banned), created_at, last_sign_in_at, avatar chip.
- Filters: org, role, status.
- Actions per row: reset password, deactivate/reactivate, change role/org, edit display name/login.
- Bulk: deactivate/reactivate.

## Create user form
- Fields: login (username), password, display name, first name, last name, role, org, optional avatar upload.
- Warning: “Synthetic email; no inbox. Password resets are admin-only. Login updates change the synthetic email.”

## Reset password flow
- Admin clicks “Reset password” → modal asks for new password → show it once.

## Deactivate
- Toggle `is_active` (org_members) and optionally set `banned_until`.
- UI badge for inactive users; block login via RLS + banned_until check.

## User profile (self-service)
- Profile drawer/page lets user change display name and avatar; `login` is view-only.
- Avatar upload writes to storage bucket `avatars/{user_id}/...`; display immediately on save.

## Edit UI
- Use in-app dialog (no browser prompts) for editing display name, first/last name, login, and avatar URL.
