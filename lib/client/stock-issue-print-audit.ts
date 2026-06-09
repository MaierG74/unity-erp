'use client';

import { supabase } from '@/lib/supabase';

export type StockIssuePrintRequestAction = 'print' | 'download' | 'open' | 'preview';

type JsonMetadata = Record<string, unknown>;

type LogStockIssuePrintRequestsInput = {
  stockIssuanceIds?: Array<number | null | undefined>;
  stockIssuanceId?: number | null;
  orgId?: string | null;
  orderId?: number | null;
  customerId?: number | string | null;
  orderReference?: string | null;
  customerName?: string | null;
  source: string;
  requestAction?: StockIssuePrintRequestAction;
  metadata?: JsonMetadata;
};

type LogStockIssuePrintRequestsResult = {
  success: boolean;
  count: number;
  error?: Error;
};

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeCustomerId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function uniqueIssuanceIds(input: LogStockIssuePrintRequestsInput): number[] {
  const ids = new Set<number>();
  if (Number.isFinite(input.stockIssuanceId)) {
    ids.add(Number(input.stockIssuanceId));
  }
  input.stockIssuanceIds?.forEach((id) => {
    if (Number.isFinite(id)) ids.add(Number(id));
  });
  return Array.from(ids).sort((a, b) => a - b);
}

export async function logStockIssuePrintRequests(
  input: LogStockIssuePrintRequestsInput
): Promise<LogStockIssuePrintRequestsResult> {
  const source = normalizeText(input.source);
  if (!source) {
    return {
      success: false,
      count: 0,
      error: new Error('Print request source is required'),
    };
  }

  const issuanceIds = uniqueIssuanceIds(input);
  const metadata = input.metadata ?? {};
  const baseRow = {
    org_id: input.orgId ?? null,
    order_id: input.orderId ?? null,
    customer_id: normalizeCustomerId(input.customerId),
    order_reference: normalizeText(input.orderReference),
    customer_name: normalizeText(input.customerName),
    source,
    request_action: input.requestAction ?? 'print',
    metadata,
  };

  const rows = issuanceIds.length > 0
    ? issuanceIds.map((issuanceId) => ({
        ...baseRow,
        stock_issuance_id: issuanceId,
      }))
    : [{ ...baseRow, stock_issuance_id: input.stockIssuanceId ?? null }];

  const { error } = await supabase
    .from('stock_issuance_print_requests')
    .insert(rows);

  if (error) {
    const wrapped = new Error(error.message);
    console.warn('[stock-issue-print-audit] Failed to log print request', error);
    return { success: false, count: 0, error: wrapped };
  }

  return { success: true, count: rows.length };
}
