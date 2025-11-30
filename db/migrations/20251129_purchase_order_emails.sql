-- Migration: Create purchase_order_emails table for tracking sent emails
-- Created: 2025-11-29
-- Description: Tracks emails sent to suppliers for purchase orders

-- Table to track emails sent for purchase orders
CREATE TABLE IF NOT EXISTS purchase_order_emails (
  email_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(supplier_id),
  recipient_email TEXT NOT NULL,
  cc_emails TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  message_id TEXT, -- Resend message ID for tracking
  error_message TEXT, -- Error details if failed
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by UUID REFERENCES auth.users(id)
);

-- Index for quick lookups by purchase order
CREATE INDEX idx_purchase_order_emails_po_id ON purchase_order_emails(purchase_order_id);

-- Index for lookups by supplier
CREATE INDEX idx_purchase_order_emails_supplier_id ON purchase_order_emails(supplier_id);

-- RLS policies
ALTER TABLE purchase_order_emails ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view email records
CREATE POLICY "Allow authenticated users to view purchase order emails"
  ON purchase_order_emails FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert email records
CREATE POLICY "Allow authenticated users to insert purchase order emails"
  ON purchase_order_emails FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE purchase_order_emails IS 'Tracks emails sent to suppliers for purchase orders';
