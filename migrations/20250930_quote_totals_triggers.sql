-- Migration: Add automatic total calculation for quotes
-- Created: 2025-09-30
-- Purpose: Automatically maintain quote_items.total and quotes.grand_total

-- Function to update quote_items.total (qty * unit_price)
CREATE OR REPLACE FUNCTION update_quote_item_total()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total = NEW.qty * NEW.unit_price;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update quote_items.total on insert/update
DROP TRIGGER IF EXISTS quote_item_total_trigger ON quote_items;
CREATE TRIGGER quote_item_total_trigger
  BEFORE INSERT OR UPDATE OF qty, unit_price
  ON quote_items
  FOR EACH ROW
  EXECUTE FUNCTION update_quote_item_total();

-- Function to update quotes.grand_total and subtotal
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

  -- Calculate sum of all item totals
  SELECT COALESCE(SUM(total), 0)
  INTO items_sum
  FROM quote_items
  WHERE quote_id = quote_uuid;

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

-- Trigger to update quotes.grand_total when quote_items change
DROP TRIGGER IF EXISTS quote_items_total_update_trigger ON quote_items;
CREATE TRIGGER quote_items_total_update_trigger
  AFTER INSERT OR UPDATE OR DELETE
  ON quote_items
  FOR EACH ROW
  EXECUTE FUNCTION update_quote_totals();

-- Fix existing data: update all quote_items.total
UPDATE quote_items
SET total = qty * unit_price
WHERE total != qty * unit_price OR total IS NULL;

-- Fix existing data: update all quotes totals
UPDATE quotes q
SET
  subtotal = COALESCE((
    SELECT SUM(total)
    FROM quote_items
    WHERE quote_id = q.id
  ), 0),
  vat_amount = COALESCE((
    SELECT SUM(total)
    FROM quote_items
    WHERE quote_id = q.id
  ), 0) * (COALESCE(q.vat_rate, 15) / 100),
  grand_total = COALESCE((
    SELECT SUM(total)
    FROM quote_items
    WHERE quote_id = q.id
  ), 0) * (1 + COALESCE(q.vat_rate, 15) / 100),
  updated_at = NOW();
