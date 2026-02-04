-- Migration: Add item types to quote_items (priced, heading, note)
-- Created: 2026-02-04
-- Purpose: Allow non-priced items (headings, notes, images) in quotes

-- 1. Create enum type for quote item types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_item_type') THEN
    CREATE TYPE quote_item_type AS ENUM ('priced', 'heading', 'note');
  END IF;
END
$$;

-- 2. Add item_type column to quote_items (default 'priced' for backwards compatibility)
ALTER TABLE quote_items
ADD COLUMN IF NOT EXISTS item_type quote_item_type NOT NULL DEFAULT 'priced';

-- 3. Update trigger to set total=0 for non-priced items
CREATE OR REPLACE FUNCTION update_quote_item_total()
RETURNS TRIGGER AS $$
BEGIN
  -- Non-priced items always have total = 0
  IF NEW.item_type != 'priced' THEN
    NEW.total = 0;
    NEW.qty = 0;
    NEW.unit_price = 0;
  ELSE
    NEW.total = NEW.qty * NEW.unit_price;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Update trigger to fire on item_type changes too
DROP TRIGGER IF EXISTS quote_item_total_trigger ON quote_items;
CREATE TRIGGER quote_item_total_trigger
  BEFORE INSERT OR UPDATE OF qty, unit_price, item_type
  ON quote_items
  FOR EACH ROW
  EXECUTE FUNCTION update_quote_item_total();

-- 5. Update quote totals function to only sum priced items
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  quote_uuid UUID;
  items_sum NUMERIC;
  vat_rate NUMERIC;
  vat_amt NUMERIC;
  grand NUMERIC;
BEGIN
  -- Determine which quote to update
  IF TG_OP = 'DELETE' THEN
    quote_uuid := OLD.quote_id;
  ELSE
    quote_uuid := NEW.quote_id;
  END IF;

  -- Calculate sum of ONLY priced item totals
  SELECT COALESCE(SUM(total), 0)
  INTO items_sum
  FROM quote_items
  WHERE quote_id = quote_uuid
    AND item_type = 'priced';

  -- Get current VAT rate (stored as percentage, e.g., 15.00 = 15%) or default to 15
  SELECT COALESCE(quotes.vat_rate, 15)
  INTO vat_rate
  FROM quotes
  WHERE id = quote_uuid;

  -- Calculate VAT amount (convert percentage to decimal by dividing by 100)
  vat_amt := items_sum * (vat_rate / 100);

  -- Calculate grand total
  grand := items_sum + vat_amt;

  -- Update the quote
  UPDATE quotes
  SET
    subtotal = items_sum,
    vat_amount = vat_amt,
    grand_total = grand,
    updated_at = NOW()
  WHERE id = quote_uuid;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 6. Recalculate all quote totals (in case any existing items need adjustment)
-- This is idempotent since all existing items default to 'priced'
UPDATE quotes q
SET
  subtotal = COALESCE((
    SELECT SUM(total)
    FROM quote_items
    WHERE quote_id = q.id AND item_type = 'priced'
  ), 0),
  vat_amount = COALESCE((
    SELECT SUM(total)
    FROM quote_items
    WHERE quote_id = q.id AND item_type = 'priced'
  ), 0) * (COALESCE(q.vat_rate, 15) / 100),
  grand_total = COALESCE((
    SELECT SUM(total)
    FROM quote_items
    WHERE quote_id = q.id AND item_type = 'priced'
  ), 0) * (1 + COALESCE(q.vat_rate, 15) / 100),
  updated_at = NOW();
