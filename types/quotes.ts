// Types for the Quotes System

export interface Quote {
  quote_id: number;
  quote_number: string;
  customer_id: number | null;
  contact_id: number | null;
  created_at: string;
  updated_at: string;
  valid_until: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  notes: string | null;
  terms_conditions: string | null;
  created_by: string | null;

  // Relations
  customer?: Customer;
  contact?: import('@/types/customers').CustomerContact | null;
  line_items?: QuoteLineItem[];
  reference_images?: QuoteReferenceImage[];
}

export interface QuoteLineItem {
  line_item_id: number;
  quote_id: number;
  line_number: number;
  description: string;
  detailed_specs: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  updated_at: string;
  
  // Relations
  attachments?: QuoteLineAttachment[];
}

export interface QuoteLineAttachment {
  attachment_id: number;
  line_item_id: number;
  file_name: string;
  file_path: string;
  file_type: 'image' | 'document';
  mime_type: string;
  file_size: number | null;
  display_in_quote: boolean;
  display_order: number;
  created_at: string;
}

export interface QuoteReferenceImage {
  reference_id: number;
  quote_id: number;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_size: number | null;
  display_order: number;
  created_at: string;
}

export interface QuoteCompanySettings {
  setting_id: number;
  company_name: string;
  company_logo_path: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vat_number: string | null;
  bank_details: string | null;
  terms_conditions: string | null;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  created_at: string;
  name: string | null;
  contact: string | null;
  email: string | null;
  telephone: string | null;
}

// Form types for creating/editing
export interface CreateQuoteData {
  customer_id: number | null;
  contact_id?: number | null;
  valid_until: string | null;
  notes: string | null;
  terms_conditions: string | null;
}

export interface CreateQuoteLineItemData {
  description: string;
  detailed_specs: string | null;
  quantity: number;
  unit_price: number;
}

export interface UpdateQuoteLineItemData extends CreateQuoteLineItemData {
  line_item_id: number;
}

// PDF generation types
export interface QuotePDFData {
  quote: Quote;
  company_settings: QuoteCompanySettings;
  line_items_with_attachments: (QuoteLineItem & {
    attachments: QuoteLineAttachment[];
  })[];
  reference_images: QuoteReferenceImage[];
}

// API response types
export interface QuotesResponse {
  data: Quote[];
  count: number;
}

export interface QuoteResponse {
  data: Quote;
}

// File upload types
export interface FileUploadResult {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
}

export interface QuoteFilters {
  status?: Quote['status'];
  customer_id?: number;
  date_from?: string;
  date_to?: string;
  search?: string;
}
