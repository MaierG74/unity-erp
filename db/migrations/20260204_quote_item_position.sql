-- Migration: Add position column to quote_items for ordering
-- Created: 2026-02-04
-- Purpose: Allow reordering of quote line items

-- Add position column (default 0 for backwards compatibility)
ALTER TABLE quote_items
ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Set initial positions based on existing item order (by id for consistency)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY quote_id ORDER BY id) - 1 AS new_position
  FROM quote_items
)
UPDATE quote_items
SET position = ranked.new_position
FROM ranked
WHERE quote_items.id = ranked.id;

-- Create index for efficient ordering queries
CREATE INDEX IF NOT EXISTS idx_quote_items_position ON quote_items(quote_id, position);
