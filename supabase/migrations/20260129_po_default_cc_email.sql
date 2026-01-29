-- Add default CC email for purchase order emails
ALTER TABLE quote_company_settings
ADD COLUMN IF NOT EXISTS po_default_cc_email text;

-- Set initial value for existing row
UPDATE quote_company_settings
SET po_default_cc_email = 'orders@qbutton.co.za'
WHERE setting_id = 1;
