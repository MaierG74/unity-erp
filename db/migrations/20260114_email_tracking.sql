-- Email Tracking System
-- Stores webhook events from Resend for delivery tracking

-- Create email_events table to store all Resend webhook events
CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Resend identifiers
  resend_email_id TEXT NOT NULL,  -- The email ID from Resend
  resend_event_id TEXT,           -- Unique event ID from webhook

  -- Event details
  event_type TEXT NOT NULL,       -- sent, delivered, bounced, complained, opened, clicked, delivery_delayed
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Email details (denormalized for quick access)
  recipient_email TEXT NOT NULL,
  subject TEXT,

  -- Link to our records (nullable - we link what we can)
  purchase_order_id BIGINT REFERENCES purchase_orders(purchase_order_id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,

  -- Bounce/complaint details
  bounce_type TEXT,               -- hard, soft
  bounce_message TEXT,
  complaint_type TEXT,

  -- Raw webhook payload for debugging
  raw_payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_email_events_resend_email_id ON email_events(resend_email_id);
CREATE INDEX IF NOT EXISTS idx_email_events_purchase_order_id ON email_events(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_email_events_quote_id ON email_events(quote_id);
CREATE INDEX IF NOT EXISTS idx_email_events_event_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON email_events(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_events_timestamp ON email_events(event_timestamp DESC);

-- Add delivery_status column to purchase_order_emails if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_order_emails' AND column_name = 'delivery_status'
  ) THEN
    ALTER TABLE purchase_order_emails ADD COLUMN delivery_status TEXT DEFAULT 'sent';
    ALTER TABLE purchase_order_emails ADD COLUMN delivered_at TIMESTAMPTZ;
    ALTER TABLE purchase_order_emails ADD COLUMN bounced_at TIMESTAMPTZ;
    ALTER TABLE purchase_order_emails ADD COLUMN bounce_reason TEXT;
  END IF;
END $$;

-- Add delivery_status column to quote_email_log if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quote_email_log' AND column_name = 'delivery_status'
  ) THEN
    ALTER TABLE quote_email_log ADD COLUMN delivery_status TEXT DEFAULT 'sent';
    ALTER TABLE quote_email_log ADD COLUMN delivered_at TIMESTAMPTZ;
    ALTER TABLE quote_email_log ADD COLUMN bounced_at TIMESTAMPTZ;
    ALTER TABLE quote_email_log ADD COLUMN bounce_reason TEXT;
  END IF;
END $$;

-- Enable RLS on email_events
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read email events
CREATE POLICY "Users can view email events" ON email_events
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow service role to insert (for webhook)
CREATE POLICY "Service role can insert email events" ON email_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE email_events IS 'Stores email delivery events from Resend webhooks for tracking delivery status';
