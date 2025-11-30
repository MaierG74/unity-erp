-- Migration: Add PO follow-up support to component_follow_up_emails
-- Created: 2025-11-29
-- Description: Allows PO-level follow-ups to use the same tracking system as component follow-ups

-- Add purchase_order_id to component_follow_up_emails to support PO-level follow-ups
ALTER TABLE component_follow_up_emails 
ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE;

-- Make component_id nullable since PO follow-ups don't have a single component
ALTER TABLE component_follow_up_emails 
ALTER COLUMN component_id DROP NOT NULL;

-- Add index for PO lookups
CREATE INDEX IF NOT EXISTS idx_component_follow_up_emails_po_id 
ON component_follow_up_emails(purchase_order_id) 
WHERE purchase_order_id IS NOT NULL;

COMMENT ON COLUMN component_follow_up_emails.purchase_order_id IS 'For PO-level follow-ups (null for component-level follow-ups)';
