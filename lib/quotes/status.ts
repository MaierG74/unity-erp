import type { BadgeProps } from '@/components/ui/badge';

export const QUOTE_STATUSES = ['draft', 'sent', 'ordered'] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

type QuoteStatusMeta = {
  label: string;
  badgeVariant: BadgeProps['variant'];
  customerBadgeClassName: string;
};

const QUOTE_STATUS_META: Record<QuoteStatus, QuoteStatusMeta> = {
  draft: {
    label: 'Draft',
    badgeVariant: 'outline',
    customerBadgeClassName:
      'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300',
  },
  sent: {
    label: 'Quote Sent',
    badgeVariant: 'warning',
    customerBadgeClassName:
      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  },
  ordered: {
    label: 'Converted to Order',
    badgeVariant: 'success',
    customerBadgeClassName:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
};

export function isQuoteStatus(value: string): value is QuoteStatus {
  return QUOTE_STATUSES.includes(value as QuoteStatus);
}

export function getQuoteStatusLabel(status: string | null | undefined): string {
  if (!status) return QUOTE_STATUS_META.draft.label;
  return isQuoteStatus(status) ? QUOTE_STATUS_META[status].label : status;
}

export function getQuoteStatusBadgeVariant(status: string | null | undefined): BadgeProps['variant'] {
  if (!status || !isQuoteStatus(status)) return 'outline';
  return QUOTE_STATUS_META[status].badgeVariant;
}

export function getQuoteStatusCustomerBadgeClassName(status: string | null | undefined): string {
  if (!status || !isQuoteStatus(status)) return QUOTE_STATUS_META.draft.customerBadgeClassName;
  return QUOTE_STATUS_META[status].customerBadgeClassName;
}
