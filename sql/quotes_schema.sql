-- Quotes System Schema
-- Run this SQL in Supabase SQL Editor

-- Main quotes table
CREATE TABLE public.quotes (
  quote_id serial NOT NULL,
  quote_number text NOT NULL,
  customer_id bigint NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  valid_until date NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  subtotal numeric(10,2) NULL DEFAULT 0,
  vat_rate numeric(5,2) NULL DEFAULT 15.00,
  vat_amount numeric(10,2) NULL DEFAULT 0,
  total_amount numeric(10,2) NULL DEFAULT 0,
  notes text NULL,
  terms_conditions text NULL,
  created_by uuid NULL,
  CONSTRAINT quotes_pkey PRIMARY KEY (quote_id),
  CONSTRAINT quotes_quote_number_key UNIQUE (quote_number),
  CONSTRAINT quotes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id),
  CONSTRAINT quotes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);

-- Quote line items
CREATE TABLE public.quote_line_items (
  line_item_id serial NOT NULL,
  quote_id integer NOT NULL,
  line_number integer NOT NULL,
  description text NOT NULL,
  detailed_specs text NULL, -- Rich text specifications
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  line_total numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quote_line_items_pkey PRIMARY KEY (line_item_id),
  CONSTRAINT quote_line_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(quote_id) ON DELETE CASCADE,
  CONSTRAINT quote_line_items_unique_line UNIQUE (quote_id, line_number)
);

-- Attachments for line items (images, documents)
CREATE TABLE public.quote_line_attachments (
  attachment_id serial NOT NULL,
  line_item_id integer NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL, -- Supabase storage path
  file_type text NOT NULL, -- 'image' or 'document'
  mime_type text NOT NULL,
  file_size bigint NULL,
  display_in_quote boolean NOT NULL DEFAULT true, -- Whether to show in PDF
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quote_line_attachments_pkey PRIMARY KEY (attachment_id),
  CONSTRAINT quote_line_attachments_line_item_id_fkey FOREIGN KEY (line_item_id) REFERENCES public.quote_line_items(line_item_id) ON DELETE CASCADE
);

-- Reference images (floorplans, material samples, etc.)
CREATE TABLE public.quote_reference_images (
  reference_id serial NOT NULL,
  quote_id integer NOT NULL,
  title text NOT NULL,
  description text NULL,
  file_name text NOT NULL,
  file_path text NOT NULL, -- Supabase storage path
  mime_type text NOT NULL,
  file_size bigint NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quote_reference_images_pkey PRIMARY KEY (reference_id),
  CONSTRAINT quote_reference_images_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quotes(quote_id) ON DELETE CASCADE
);

-- Company settings for quote branding
CREATE TABLE public.quote_company_settings (
  setting_id serial NOT NULL,
  company_name text NOT NULL,
  company_logo_path text NULL, -- Supabase storage path
  address_line1 text NULL,
  address_line2 text NULL,
  city text NULL,
  postal_code text NULL,
  country text NULL,
  phone text NULL,
  email text NULL,
  website text NULL,
  vat_number text NULL,
  bank_details text NULL,
  terms_conditions text NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT quote_company_settings_pkey PRIMARY KEY (setting_id)
);

-- Insert default company settings
INSERT INTO public.quote_company_settings (
  company_name,
  address_line1,
  city,
  country,
  phone,
  email,
  terms_conditions
) VALUES (
  'Your Company Name',
  'Your Address',
  'Your City',
  'South Africa',
  '+27 XX XXX XXXX',
  'info@yourcompany.com',
  'Payment terms: 30 days from invoice date. All prices exclude VAT unless otherwise stated.'
);

-- Create indexes for better performance
CREATE INDEX idx_quotes_customer_id ON public.quotes(customer_id);
CREATE INDEX idx_quotes_status ON public.quotes(status);
CREATE INDEX idx_quotes_created_at ON public.quotes(created_at);
CREATE INDEX idx_quote_line_items_quote_id ON public.quote_line_items(quote_id);
CREATE INDEX idx_quote_line_attachments_line_item_id ON public.quote_line_attachments(line_item_id);
CREATE INDEX idx_quote_reference_images_quote_id ON public.quote_reference_images(quote_id);

-- Enable RLS (Row Level Security)
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_line_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_company_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Quotes: Users can see all quotes (adjust as needed for your business logic)
CREATE POLICY "Users can view all quotes" ON public.quotes
  FOR SELECT USING (true);

CREATE POLICY "Users can insert quotes" ON public.quotes
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update quotes" ON public.quotes
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete quotes" ON public.quotes
  FOR DELETE USING (true);

-- Quote line items: Inherit access from parent quote
CREATE POLICY "Users can view quote line items" ON public.quote_line_items
  FOR SELECT USING (true);

CREATE POLICY "Users can insert quote line items" ON public.quote_line_items
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update quote line items" ON public.quote_line_items
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete quote line items" ON public.quote_line_items
  FOR DELETE USING (true);

-- Quote line attachments: Inherit access from parent line item
CREATE POLICY "Users can view quote line attachments" ON public.quote_line_attachments
  FOR SELECT USING (true);

CREATE POLICY "Users can insert quote line attachments" ON public.quote_line_attachments
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update quote line attachments" ON public.quote_line_attachments
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete quote line attachments" ON public.quote_line_attachments
  FOR DELETE USING (true);

-- Quote reference images: Inherit access from parent quote
CREATE POLICY "Users can view quote reference images" ON public.quote_reference_images
  FOR SELECT USING (true);

CREATE POLICY "Users can insert quote reference images" ON public.quote_reference_images
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update quote reference images" ON public.quote_reference_images
  FOR UPDATE USING (true);

CREATE POLICY "Users can delete quote reference images" ON public.quote_reference_images
  FOR DELETE USING (true);

-- Company settings: All users can read, only admins can modify (adjust as needed)
CREATE POLICY "Users can view company settings" ON public.quote_company_settings
  FOR SELECT USING (true);

CREATE POLICY "Users can update company settings" ON public.quote_company_settings
  FOR UPDATE USING (true);

-- Functions for automatic calculations
CREATE OR REPLACE FUNCTION calculate_quote_line_total()
RETURNS TRIGGER AS $$
BEGIN
  NEW.line_total = NEW.quantity * NEW.unit_price;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for line item calculations
CREATE TRIGGER trigger_calculate_line_total
  BEFORE INSERT OR UPDATE ON public.quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_quote_line_total();

-- Function to update quote totals
CREATE OR REPLACE FUNCTION update_quote_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.quotes 
  SET 
    subtotal = (
      SELECT COALESCE(SUM(line_total), 0) 
      FROM public.quote_line_items 
      WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id)
    ),
    updated_at = now()
  WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id);
  
  -- Update VAT and total amounts
  UPDATE public.quotes 
  SET 
    vat_amount = subtotal * (vat_rate / 100),
    total_amount = subtotal + (subtotal * (vat_rate / 100))
  WHERE quote_id = COALESCE(NEW.quote_id, OLD.quote_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger to update quote totals when line items change
CREATE TRIGGER trigger_update_quote_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION update_quote_totals();

-- Function to generate quote numbers
CREATE OR REPLACE FUNCTION generate_quote_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = '' THEN
    NEW.quote_number = 'QUO-' || TO_CHAR(now(), 'YYYY') || '-' || LPAD(nextval('quotes_quote_id_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for quote number generation
CREATE TRIGGER trigger_generate_quote_number
  BEFORE INSERT ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION generate_quote_number();
