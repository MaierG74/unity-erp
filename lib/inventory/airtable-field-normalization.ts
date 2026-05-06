type AirtableAttachment = {
  url?: unknown;
};

export function airtableFieldToString(value: unknown): string {
  if (value == null) return '';

  if (Array.isArray(value)) {
    return value
      .map((item) => airtableFieldToString(item))
      .filter(Boolean)
      .join(', ');
  }

  if (typeof value === 'object') {
    return '';
  }

  return String(value).trim();
}

export function airtableFieldToNumber(value: unknown): number {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (typeof normalized === 'number') return normalized;

  const parsed = Number(airtableFieldToString(normalized));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function airtableAttachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;

  const firstAttachment = value[0] as AirtableAttachment | undefined;
  return typeof firstAttachment?.url === 'string' ? firstAttachment.url : null;
}
