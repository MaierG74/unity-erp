-- Migration: Add typed purchase order email logging for cancellation workflows
-- Created: 2026-02-12

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'purchase_order_emails' AND column_name = 'email_type'
  ) THEN
    ALTER TABLE purchase_order_emails
      ADD COLUMN email_type TEXT NOT NULL DEFAULT 'po_send';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'purchase_order_emails' AND column_name = 'supplier_order_id'
  ) THEN
    ALTER TABLE purchase_order_emails
      ADD COLUMN supplier_order_id BIGINT REFERENCES supplier_orders(order_id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_order_emails_email_type_check'
  ) THEN
    ALTER TABLE purchase_order_emails
      ADD CONSTRAINT purchase_order_emails_email_type_check
      CHECK (email_type IN ('po_send', 'po_cancel', 'po_line_cancel', 'po_follow_up'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_order_emails_email_type
  ON purchase_order_emails(email_type);

CREATE INDEX IF NOT EXISTS idx_purchase_order_emails_supplier_order_id
  ON purchase_order_emails(supplier_order_id);

-- Backfill existing rows to a safe default for older sends.
UPDATE purchase_order_emails
SET email_type = 'po_send'
WHERE email_type IS NULL;
