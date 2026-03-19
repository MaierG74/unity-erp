import type { SupabaseClient } from '@supabase/supabase-js';

type OrderRelation = {
  status_name?: string | null;
};

type CustomerRelation = {
  name?: string | null;
};

type QuoteRelation = {
  id?: string | number | null;
  quote_number?: string | null;
};

type ProductRelation = {
  name?: string | null;
  internal_code?: string | null;
};

type OrderPreviewHeaderRow = {
  order_id: number;
  order_number?: string | null;
  order_date?: string | null;
  created_at?: string | null;
  delivery_date?: string | null;
  status?: OrderRelation | OrderRelation[] | null;
  customer?: CustomerRelation | CustomerRelation[] | null;
  quote?: QuoteRelation | QuoteRelation[] | null;
};

type OrderPreviewDetailRow = {
  order_detail_id: number;
  quantity?: number | string | null;
  product?: ProductRelation | ProductRelation[] | null;
};

type OrderAttachmentRow = {
  id: number;
  file_name?: string | null;
  file_url?: string | null;
  document_type?: string | null;
  uploaded_at?: string | null;
};

export type AssistantOrderPreview = {
  orderId: number;
  orderNumber: string | null;
  customerName: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  statusName: string | null;
  quote: {
    id: string;
    quoteNumber: string | null;
  } | null;
  counts: {
    products: number;
    attachments: number;
    customerOrderDocs: number;
    jobCards: number;
    purchaseOrders: number;
    issuedItems: number;
  };
  products: Array<{
    name: string;
    quantity: number;
  }>;
  customerDocuments: Array<{
    id: number;
    name: string;
    uploadedAt: string | null;
    url: string | null;
  }>;
  recentDocuments: Array<{
    id: number;
    name: string;
    type: string | null;
    uploadedAt: string | null;
    url: string | null;
  }>;
};

function getRelationRecord<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}

export async function getAssistantOrderPreview(
  supabase: SupabaseClient,
  orderId: number
): Promise<AssistantOrderPreview | null> {
  const { data: headerData, error: headerError } = await supabase
    .from('orders')
    .select(
      'order_id, order_number, order_date, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)'
    )
    .eq('order_id', orderId)
    .maybeSingle();

  if (headerError) {
    throw headerError;
  }

  if (!headerData) {
    return null;
  }

  const header = headerData as OrderPreviewHeaderRow;

  const [
    { data: detailRows, error: detailError },
    { data: attachmentRows, error: attachmentError },
    { count: jobCardCount, error: jobCardError },
    { count: purchaseOrderCount, error: purchaseOrderError },
    { count: issuedCount, error: issuedError },
  ] = await Promise.all([
    supabase
      .from('order_details')
      .select('order_detail_id, quantity, product:products(name, internal_code)')
      .eq('order_id', orderId)
      .limit(6),
    supabase
      .from('order_attachments')
      .select('id, file_name, file_url, document_type, uploaded_at')
      .eq('order_id', orderId)
      .order('uploaded_at', { ascending: false })
      .limit(12),
    supabase
      .from('job_cards')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', orderId),
    supabase
      .from('supplier_order_customer_orders')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', orderId),
    supabase
      .from('stock_issuances')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', orderId),
  ]);

  if (detailError) throw detailError;
  if (attachmentError) throw attachmentError;
  if (jobCardError) throw jobCardError;
  if (purchaseOrderError) throw purchaseOrderError;
  if (issuedError) throw issuedError;

  const status = getRelationRecord(header.status);
  const customer = getRelationRecord(header.customer);
  const quote = getRelationRecord(header.quote);
  const attachments = (attachmentRows ?? []) as OrderAttachmentRow[];
  const customerDocuments = attachments.filter(
    attachment => (attachment.document_type?.trim() || '').toLowerCase() === 'customer_order'
  );

  return {
    orderId: header.order_id,
    orderNumber: header.order_number?.trim() || null,
    customerName: customer?.name?.trim() || null,
    orderDate: normalizeDate(header.order_date || header.created_at || null),
    deliveryDate: normalizeDate(header.delivery_date),
    statusName: status?.status_name?.trim() || null,
    quote:
      quote?.id == null
        ? null
        : {
            id: typeof quote.id === 'string' ? quote.id.trim() : String(quote.id),
            quoteNumber: quote.quote_number?.trim() || null,
          },
    counts: {
      products: (detailRows ?? []).length,
      attachments: attachments.length,
      customerOrderDocs: customerDocuments.length,
      jobCards: jobCardCount ?? 0,
      purchaseOrders: purchaseOrderCount ?? 0,
      issuedItems: issuedCount ?? 0,
    },
    products: ((detailRows ?? []) as OrderPreviewDetailRow[]).map(detail => {
      const product = getRelationRecord(detail.product);
      return {
        name:
          product?.name?.trim() ||
          product?.internal_code?.trim() ||
          `Product ${detail.order_detail_id}`,
        quantity: toNumber(detail.quantity),
      };
    }),
    customerDocuments: customerDocuments.map(document => ({
      id: document.id,
      name: document.file_name?.trim() || 'Customer document',
      uploadedAt: normalizeDate(document.uploaded_at),
      url: document.file_url?.trim() || null,
    })),
    recentDocuments: attachments.map(document => ({
      id: document.id,
      name: document.file_name?.trim() || 'Document',
      type: document.document_type?.trim() || null,
      uploadedAt: normalizeDate(document.uploaded_at),
      url: document.file_url?.trim() || null,
    })),
  };
}
