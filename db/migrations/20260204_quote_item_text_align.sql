-- Migration: Add text alignment to quote_items
-- Created: 2026-02-04
-- Purpose: Allow left/center/right alignment for heading and note items

-- Add text_align column (default 'left' for backwards compatibility)
ALTER TABLE quote_items
ADD COLUMN IF NOT EXISTS text_align TEXT NOT NULL DEFAULT 'left'
CHECK (text_align IN ('left', 'center', 'right'));
