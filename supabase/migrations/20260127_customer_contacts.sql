-- Migration: Create customer_contacts table (address book for customer staff)
-- Date: 2026-01-27

-- Create the customer_contacts table
CREATE TABLE IF NOT EXISTS customer_contacts (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  job_title TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by customer
CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer_id
  ON customer_contacts(customer_id);

-- Partial unique index: only one primary contact per customer
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_contacts_one_primary
  ON customer_contacts(customer_id) WHERE is_primary = true;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_customer_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_customer_contacts_updated_at ON customer_contacts;
CREATE TRIGGER trigger_update_customer_contacts_updated_at
  BEFORE UPDATE ON customer_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_contacts_updated_at();

-- Enable RLS
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow all authenticated users)
DROP POLICY IF EXISTS "Allow authenticated users to view customer_contacts" ON customer_contacts;
CREATE POLICY "Allow authenticated users to view customer_contacts"
  ON customer_contacts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert customer_contacts" ON customer_contacts;
CREATE POLICY "Allow authenticated users to insert customer_contacts"
  ON customer_contacts FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to update customer_contacts" ON customer_contacts;
CREATE POLICY "Allow authenticated users to update customer_contacts"
  ON customer_contacts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to delete customer_contacts" ON customer_contacts;
CREATE POLICY "Allow authenticated users to delete customer_contacts"
  ON customer_contacts FOR DELETE TO authenticated USING (true);

-- Migrate existing customer contact data into customer_contacts
INSERT INTO customer_contacts (customer_id, name, email, phone, is_primary)
SELECT
  id,
  COALESCE(contact, name, 'Unknown'),
  email,
  telephone,
  true
FROM customers
WHERE contact IS NOT NULL OR email IS NOT NULL OR telephone IS NOT NULL;

-- Add contact_id column to quotes table
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_id BIGINT
  REFERENCES customer_contacts(id) ON DELETE SET NULL;

-- Backfill contact_id on existing quotes: set to the primary contact of the customer
UPDATE quotes q
SET contact_id = cc.id
FROM customer_contacts cc
WHERE q.customer_id = cc.customer_id
  AND cc.is_primary = true
  AND q.contact_id IS NULL;

COMMENT ON TABLE customer_contacts IS 'Address book of staff contacts for each customer, used in quotes and emails';
