-- Migration: Create quote_email_log table for tracking quote email sends
-- Date: 2025-10-05
-- Purpose: Audit trail for quote emails sent to customers via Resend

-- Create the quote_email_log table
CREATE TABLE IF NOT EXISTS quote_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_by UUID REFERENCES auth.users(id),
  resend_message_id TEXT, -- Resend's message ID for tracking deliverability
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT, -- Error details if status is 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index for efficient lookups by quote
CREATE INDEX IF NOT EXISTS idx_quote_email_log_quote_id
  ON quote_email_log(quote_id);

-- Add index for searching by sent date
CREATE INDEX IF NOT EXISTS idx_quote_email_log_sent_at
  ON quote_email_log(sent_at DESC);

-- Add index for filtering by status
CREATE INDEX IF NOT EXISTS idx_quote_email_log_status
  ON quote_email_log(status);

-- Enable Row Level Security
ALTER TABLE quote_email_log ENABLE ROW LEVEL SECURITY;

-- RLS Policy: All authenticated users can view email logs
CREATE POLICY "Users can view quote email logs"
  ON quote_email_log FOR SELECT
  USING (auth.role() = 'authenticated');

-- RLS Policy: All authenticated users can insert email logs
CREATE POLICY "Users can insert quote email logs"
  ON quote_email_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Add helpful comment
COMMENT ON TABLE quote_email_log IS 'Audit trail for quote PDFs emailed to customers via Resend';
COMMENT ON COLUMN quote_email_log.resend_message_id IS 'Message ID returned by Resend API for tracking delivery status';
COMMENT ON COLUMN quote_email_log.status IS 'Email status: sent (successfully sent), failed (send error), bounced (delivery failed)';
COMMENT ON COLUMN quote_email_log.error_message IS 'Error details when status is failed';
