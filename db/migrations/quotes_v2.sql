-- Migration: quotes_v2.sql
-- Adds notes, versions, attachment scopes, and derived fields

-- 1. Add derived fields to quotes
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total numeric(12,2) NOT NULL DEFAULT 0;

-- 2. Create attachment scope enum and extend quote_attachments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quote_attachment_scope') THEN
    CREATE TYPE quote_attachment_scope AS ENUM ('quote', 'item');
  END IF;
END $$;

ALTER TABLE quote_attachments
  ADD COLUMN IF NOT EXISTS scope quote_attachment_scope NOT NULL DEFAULT 'quote',
  ADD COLUMN IF NOT EXISTS quote_item_id uuid REFERENCES quote_items(id) ON DELETE CASCADE;

-- 3. Create quote_notes table
CREATE TABLE IF NOT EXISTS quote_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  quote_item_id uuid REFERENCES quote_items(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 4. Create quote_versions table
CREATE TABLE IF NOT EXISTS quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_label text,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 5. Function to update totals on quotes
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
DECLARE
  q_id uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    q_id := OLD.quote_id;
  ELSE
    q_id := NEW.quote_id;
  END IF;

  UPDATE quotes
  SET
    subtotal = (
      SELECT COALESCE(SUM(line_total),0) FROM quote_items WHERE quote_items.quote_id = q_id
    )::numeric(12,2),
    grand_total = ((COALESCE(subtotal,0) + COALESCE(tax,0) + COALESCE(shipping,0)) * (1 - COALESCE(discount_pct,0)/100))::numeric(12,2)
  WHERE id = q_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 6. Trigger to call update function
DROP TRIGGER IF EXISTS trg_update_quote_totals ON quote_items;
CREATE TRIGGER trg_update_quote_totals
AFTER INSERT OR UPDATE OR DELETE ON quote_items
FOR EACH ROW EXECUTE FUNCTION update_quote_totals();
