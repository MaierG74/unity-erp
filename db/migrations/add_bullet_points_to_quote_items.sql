-- Add bullet_points column to quote_items for line-item specifications (one per line)
ALTER TABLE IF EXISTS public.quote_items
  ADD COLUMN IF NOT EXISTS bullet_points text;

-- Optional: backfill or transform existing data here if needed
-- UPDATE public.quote_items SET bullet_points = '' WHERE bullet_points IS NULL;
