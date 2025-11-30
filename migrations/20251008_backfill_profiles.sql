-- Backfill missing profiles for existing auth users
-- Generated 2025-10-08
-- Purpose: populate public.profiles so To-Do module foreign keys resolve

BEGIN;

INSERT INTO public.profiles (id, username)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email) AS username
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Verification queries (run manually after executing the migration):
-- SELECT COUNT(*) AS users_with_profiles
-- FROM auth.users u
-- INNER JOIN public.profiles p ON u.id = p.id;
--
-- SELECT COUNT(*) AS users_without_profiles
-- FROM auth.users u
-- LEFT JOIN public.profiles p ON u.id = p.id
-- WHERE p.id IS NULL;
