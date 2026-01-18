export interface DocumentTemplate {
  template_id: number;
  template_type: string;
  template_category: 'quote' | 'purchase_order' | 'email';
  name: string;
  description: string | null;
  content: string;
  placeholders: TemplatePlaceholder[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TemplatePlaceholder {
  key: string;
  description: string;
}

export interface POContactInfo {
  name: string;
  email: string;
}

export type TemplateType =
  | 'quote_default_terms'
  | 'po_email_notice'
  | 'po_contact_info';

export type TemplateCategory = 'quote' | 'purchase_order' | 'email';
