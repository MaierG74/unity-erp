import type { DocumentTemplate, POContactInfo } from '@/types/templates';

/**
 * Replace {{placeholder}} patterns in template content with values from context
 */
export function processTemplate(
  template: string,
  context: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return context[key] ?? match;
  });
}

/**
 * Parse PO contact info from template content (stored as JSON)
 */
export function parsePOContactInfo(content: string): POContactInfo {
  try {
    const parsed = JSON.parse(content);
    return {
      name: parsed.name || 'Purchasing Team',
      email: parsed.email || 'orders@company.com',
    };
  } catch {
    return {
      name: 'Purchasing Team',
      email: 'orders@company.com',
    };
  }
}

/**
 * Default template content - fallbacks if database templates not found
 */
export const DEFAULT_TEMPLATES: Record<string, string> = {
  quote_default_terms: `• Payment terms: 30 days from invoice date
• All prices exclude VAT unless otherwise stated
• This quotation is valid for 30 days from the date above
• Delivery times may vary depending on stock availability`,

  po_email_notice:
    'Please verify all quantities, pricing, and specifications before processing this order. If you notice any discrepancies or have questions, contact {{contact_name}} at {{contact_email}} before proceeding.',

  po_contact_info: JSON.stringify({
    name: 'Purchasing Team',
    email: 'orders@company.com',
  }),
};

/**
 * Fetch a template by type from API, with fallback to default
 */
export async function fetchTemplate(
  templateType: string,
  baseUrl?: string
): Promise<DocumentTemplate | null> {
  try {
    const url = baseUrl
      ? `${baseUrl}/api/document-templates?type=${templateType}`
      : `/api/document-templates?type=${templateType}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) return null;

    const data = await res.json();
    return data.templates?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Get template content with fallback to default
 */
export async function getTemplateContent(
  templateType: string,
  baseUrl?: string
): Promise<string> {
  const template = await fetchTemplate(templateType, baseUrl);
  return template?.content ?? DEFAULT_TEMPLATES[templateType] ?? '';
}
