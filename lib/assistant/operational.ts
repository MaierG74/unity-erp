import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantActionLink, AssistantCard } from '@/lib/assistant/prompt-suggestions';
import {
  resolveAssistantProduct,
  type AssistantProductLookupResult,
} from '@/lib/assistant/product-resolver';

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

type CustomerLookupRow = {
  id: number;
  name?: string | null;
};

type OrderRow = {
  order_id: number;
  customer_id?: number | null;
  order_number?: string | null;
  created_at?: string | null;
  delivery_date?: string | null;
  status?: OrderRelation | OrderRelation[] | null;
  customer?: CustomerRelation | CustomerRelation[] | null;
  quote?: QuoteRelation | QuoteRelation[] | null;
};

type InventoryRow = {
  inventory_id: number;
  quantity_on_hand?: number | string | null;
  reorder_level?: number | string | null;
  component?: {
    internal_code?: string | null;
    description?: string | null;
  } | Array<{
    internal_code?: string | null;
    description?: string | null;
  }> | null;
};

type OrderStatusRpcRow = {
  component_id?: number | null;
  internal_code?: string | null;
  description?: string | null;
  order_required?: number | string | null;
  in_stock?: number | string | null;
  on_order?: number | string | null;
  reserved_this_order?: number | string | null;
  reserved_by_others?: number | string | null;
  apparent_shortfall?: number | string | null;
  real_shortfall?: number | string | null;
  global_real_shortfall?: number | string | null;
};

type OrderAttachmentLookupRow = {
  order_id: number;
  document_type?: string | null;
};

type OrderProductDetailRow = {
  order_detail_id: number;
  quantity?: number | string | null;
  product?: {
    name?: string | null;
    internal_code?: string | null;
  } | Array<{
    name?: string | null;
    internal_code?: string | null;
  }> | null;
};

type ProductOrderDetailRow = {
  order_id?: number | null;
  quantity?: number | string | null;
  order?: OrderRow | OrderRow[] | null;
};

export type AssistantOperationalIntent =
  | 'open_orders'
  | 'product_open_orders'
  | 'order_products'
  | 'last_customer_order'
  | 'recent_customer_orders'
  | 'order_search'
  | 'orders_last_7_days'
  | 'orders_due_this_week'
  | 'late_orders'
  | 'low_stock'
  | 'order_blockers';

const ORDER_QUERY_LIMIT = 60;
const CUSTOMER_QUERY_LIMIT = 12;

export type AssistantOrderSummaryRow = {
  order_id: number;
  order_number: string | null;
  customer_name: string | null;
  created_date: string | null;
  delivery_date: string | null;
  status_name: string | null;
  quote_id: string | null;
  quote_number: string | null;
  attachment_count: number;
  customer_order_doc_count: number;
};

export type AssistantOpenOrdersSummary = {
  customer_name: string | null;
  open_order_count: number;
  overdue_order_count: number;
  due_this_week_count: number;
  missing_status_count: number;
  status_breakdown: Array<{
    status_name: string;
    count: number;
  }>;
  next_due_orders: AssistantOrderSummaryRow[];
  listed_orders: AssistantOrderSummaryRow[];
};

export type AssistantDueThisWeekSummary = {
  customer_name: string | null;
  week_start: string;
  week_end: string;
  due_order_count: number;
  orders: AssistantOrderSummaryRow[];
};

export type AssistantOrdersLast7DaysSummary = {
  customer_name: string | null;
  range_start: string;
  range_end: string;
  total_order_count: number;
  average_per_day: number;
  busiest_day: {
    date: string;
    count: number;
  } | null;
  daily_counts: Array<{
    date: string;
    label: string;
    count: number;
  }>;
  recent_orders: AssistantOrderSummaryRow[];
};

export type AssistantLastCustomerOrderSummary = {
  customer_name: string;
  latest_order: AssistantOrderSummaryRow | null;
  recent_orders: AssistantOrderSummaryRow[];
};

export type AssistantProductOpenOrdersSummary =
  | {
      kind: 'summary';
      product: {
        product_id: number;
        internal_code: string | null;
        name: string | null;
        description: string | null;
      };
      open_order_count: number;
      total_quantity: number;
      overdue_order_count: number;
      due_this_week_count: number;
      orders: Array<
        AssistantOrderSummaryRow & {
          quantity: number;
        }
      >;
    }
  | Exclude<AssistantProductLookupResult, { kind: 'resolved' }>;

export type AssistantOrderSearchSummary = {
  query_term: string;
  match_mode: 'starts_with' | 'contains';
  order_count: number;
  orders: AssistantOrderSummaryRow[];
};

export type AssistantLowStockSummary = {
  low_stock_count: number;
  items: Array<{
    inventory_id: number;
    internal_code: string;
    description: string | null;
    quantity_on_hand: number;
    reorder_level: number;
    shortage_qty: number;
  }>;
};

export type AssistantLateOrdersSummary = {
  customer_name: string | null;
  late_order_count: number;
  late_orders: Array<AssistantOrderSummaryRow & {
    days_late: number;
  }>;
};

export type AssistantOrderBlockerSummary =
  | {
      kind: 'summary';
      order: {
        order_id: number;
        order_number: string | null;
        customer_name: string | null;
        delivery_date: string | null;
        status_name: string | null;
      };
      blocked_components: number;
      waiting_on_deliveries_components: number;
      ready_components: number;
      blocked_items: Array<{
        internal_code: string;
        description: string | null;
        required: number;
        in_stock: number;
        on_order: number;
        shortfall: number;
      }>;
      waiting_items: Array<{
        internal_code: string;
        description: string | null;
        required: number;
        in_stock: number;
        on_order: number;
        apparent_shortfall: number;
      }>;
    }
  | {
      kind: 'ambiguous';
      order_ref: string;
      candidates: Array<{
        order_id: number;
        order_number: string | null;
        customer_name: string | null;
      }>;
    }
  | {
      kind: 'not_found';
      order_ref: string;
    };

export type AssistantOrderProductsSummary =
  | {
      kind: 'summary';
      order: {
        order_id: number;
        order_number: string | null;
        customer_name: string | null;
        delivery_date: string | null;
        status_name: string | null;
      };
      line_count: number;
      total_quantity: number;
      products: Array<{
        order_detail_id: number;
        product_label: string;
        quantity: number;
      }>;
    }
  | {
      kind: 'ambiguous';
      order_ref: string;
      candidates: Array<{
        order_id: number;
        order_number: string | null;
        customer_name: string | null;
      }>;
    }
  | {
      kind: 'not_found';
      order_ref: string;
    };

export type AssistantOpenOrdersCustomerResolution =
  | {
      kind: 'resolved';
      customer_name: string;
    }
  | {
      kind: 'ambiguous';
      customer_ref: string;
      candidates: string[];
    }
  | {
      kind: 'not_found';
      customer_ref: string;
    };

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getRelationRecord<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function getCurrentDateInZone(timeZone = 'Africa/Johannesburg') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find(part => part.type === 'year')?.value ?? '1970';
  const month = parts.find(part => part.type === 'month')?.value ?? '01';
  const day = parts.find(part => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

function parseDateOnly(dateValue: string) {
  return new Date(`${dateValue}T00:00:00Z`);
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function differenceInDaysFromDateOnly(earlier: string, later: string) {
  const earlierDate = parseDateOnly(earlier);
  const laterDate = parseDateOnly(later);
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86_400_000);
}

function getWeekRange(dateValue: string) {
  const current = parseDateOnly(dateValue);
  const dayOfWeek = current.getUTCDay();
  const daysFromMonday = (dayOfWeek + 6) % 7;

  const weekStart = new Date(current);
  weekStart.setUTCDate(current.getUTCDate() - daysFromMonday);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return {
    week_start: formatDateOnly(weekStart),
    week_end: formatDateOnly(weekEnd),
  };
}

function getRecentDayRange(dateValue: string, dayCount: number) {
  const current = parseDateOnly(dateValue);
  const rangeStart = new Date(current);
  rangeStart.setUTCDate(current.getUTCDate() - (dayCount - 1));

  return {
    range_start: formatDateOnly(rangeStart),
    range_end: dateValue,
  };
}

function addDays(dateValue: string, days: number) {
  const date = parseDateOnly(dateValue);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

function isTerminalStatus(statusName: string | null) {
  const normalized = statusName?.trim().toLowerCase() ?? '';
  return normalized === 'completed' || normalized === 'cancelled';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatDateForAnswer(dateValue: string) {
  const date = parseDateOnly(dateValue);
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatOrderStatusLabel(statusName: string | null | undefined) {
  const normalized = statusName?.trim();
  return normalized && normalized.length > 0 ? normalized : 'Not set';
}

function formatDayLabel(dateValue: string) {
  const date = parseDateOnly(dateValue);
  return new Intl.DateTimeFormat('en-ZA', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function getDateInZoneFromTimestamp(timestamp: string, timeZone = 'Africa/Johannesburg') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));

  const year = parts.find(part => part.type === 'year')?.value ?? '1970';
  const month = parts.find(part => part.type === 'month')?.value ?? '01';
  const day = parts.find(part => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

function buildOrderLabel(order: {
  order_id: number;
  order_number: string | null;
  customer_name: string | null;
  delivery_date: string | null;
}) {
  const orderLabel = order.order_number?.trim() || `Order ${order.order_id}`;
  const customerLabel = order.customer_name?.trim() || 'Unknown customer';
  const dateLabel = order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date';
  return `${orderLabel} (${customerLabel}) due ${dateLabel}`;
}

function mapOrderRowToSummaryRow(row: OrderRow): AssistantOrderSummaryRow {
  const status = getRelationRecord(row.status);
  const customer = getRelationRecord(row.customer);
  const quote = getRelationRecord(row.quote);
  const createdAt = row.created_at?.trim() || null;

  return {
    order_id: row.order_id,
    order_number: row.order_number?.trim() || null,
    customer_name: customer?.name?.trim() || null,
    created_date: createdAt ? getDateInZoneFromTimestamp(createdAt) : null,
    delivery_date: row.delivery_date?.slice(0, 10) || null,
    status_name: status?.status_name?.trim() || null,
    quote_id:
      quote?.id == null
        ? null
        : typeof quote.id === 'string'
          ? quote.id.trim()
          : String(quote.id),
    quote_number: quote?.quote_number?.trim() || null,
    attachment_count: 0,
    customer_order_doc_count: 0,
  };
}

async function loadOrderLaunchMetadata(
  supabase: SupabaseClient,
  orderIds: number[]
) {
  const uniqueOrderIds = Array.from(new Set(orderIds.filter(orderId => Number.isFinite(orderId))));
  const metadata = new Map<number, { attachment_count: number; customer_order_doc_count: number }>();

  for (const orderId of uniqueOrderIds) {
    metadata.set(orderId, { attachment_count: 0, customer_order_doc_count: 0 });
  }

  if (uniqueOrderIds.length === 0) {
    return metadata;
  }

  const { data, error } = await supabase
    .from('order_attachments')
    .select('order_id, document_type')
    .in('order_id', uniqueOrderIds);

  if (error) {
    throw error;
  }

  for (const row of (data ?? []) as OrderAttachmentLookupRow[]) {
    const current = metadata.get(row.order_id) ?? { attachment_count: 0, customer_order_doc_count: 0 };
    current.attachment_count += 1;
    if ((row.document_type?.trim() || '').toLowerCase() === 'customer_order') {
      current.customer_order_doc_count += 1;
    }
    metadata.set(row.order_id, current);
  }

  return metadata;
}

async function enrichOrderRows(
  supabase: SupabaseClient,
  orders: AssistantOrderSummaryRow[]
) {
  const metadata = await loadOrderLaunchMetadata(
    supabase,
    orders.map(order => order.order_id)
  );

  return orders.map(order => {
    const launch = metadata.get(order.order_id);
    return {
      ...order,
      attachment_count: launch?.attachment_count ?? 0,
      customer_order_doc_count: launch?.customer_order_doc_count ?? 0,
    };
  });
}

function buildOrderQuickActions(order: AssistantOrderSummaryRow): AssistantActionLink[] {
  const orderLabel = order.order_number?.trim() || String(order.order_id);
  const actions: AssistantActionLink[] = [
    {
      label: 'Preview',
      kind: 'preview_order',
      orderId: order.order_id,
    },
    {
      label: 'Open',
      href: `/orders/${order.order_id}`,
      kind: 'navigate',
    },
    {
      label: 'Products',
      kind: 'ask',
      prompt: `What products are on order ${orderLabel}?`,
    },
    {
      label: 'Job cards',
      kind: 'ask',
      prompt: `What job cards are on order ${orderLabel}?`,
    },
    {
      label: 'Outstanding parts',
      kind: 'ask',
      prompt: `What is blocking order ${orderLabel}?`,
    },
  ];

  if (order.customer_order_doc_count > 0) {
    actions.push({
      label: `Client docs (${formatNumber(order.customer_order_doc_count)})`,
      href: `/orders/${order.order_id}?tab=documents`,
      kind: 'navigate',
    });
  } else if (order.attachment_count > 0) {
    actions.push({
      label: `Docs (${formatNumber(order.attachment_count)})`,
      href: `/orders/${order.order_id}?tab=documents`,
      kind: 'navigate',
    });
  }

  if (order.quote_id) {
    actions.push({
      label: order.quote_number ? `Quote ${order.quote_number}` : 'Quote',
      href: `/quotes/${order.quote_id}`,
      kind: 'navigate',
    });
  }

  return actions;
}

function formatAssistantProductLabel(product: {
  product_id: number;
  internal_code: string | null;
  name: string | null;
}) {
  const code = product.internal_code?.trim();
  const name = product.name?.trim();

  if (code && name && code !== name) {
    return `${name} (${code})`;
  }

  return name || code || `Product ${product.product_id}`;
}

async function loadOpenOrdersForProduct(
  supabase: SupabaseClient,
  productId: number
) {
  const { data, error } = await supabase
    .from('order_details')
    .select(
      'order_id, quantity, order:orders(order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number))'
    )
    .eq('product_id', productId)
    .limit(200);

  if (error) {
    throw error;
  }

  const aggregated = new Map<
    number,
    AssistantOrderSummaryRow & {
      quantity: number;
    }
  >();

  for (const row of (data ?? []) as ProductOrderDetailRow[]) {
    const orderRow = getRelationRecord(row.order);
    if (!orderRow) {
      continue;
    }

    const order = mapOrderRowToSummaryRow(orderRow);
    if (isTerminalStatus(order.status_name)) {
      continue;
    }

    const current = aggregated.get(order.order_id) ?? {
      ...order,
      quantity: 0,
    };
    current.quantity += Math.max(toNumber(row.quantity), 0);
    aggregated.set(order.order_id, current);
  }

  const enrichedOrders = await enrichOrderRows(
    supabase,
    Array.from(aggregated.values()).map(({ quantity: _quantity, ...order }) => order)
  );
  const quantityByOrderId = new Map(
    Array.from(aggregated.values()).map(order => [order.order_id, order.quantity])
  );

  return enrichedOrders
    .map(order => ({
      ...order,
      quantity: quantityByOrderId.get(order.order_id) ?? 0,
    }))
    .sort((a, b) => {
      const aDate = a.delivery_date ?? '9999-12-31';
      const bDate = b.delivery_date ?? '9999-12-31';
      if (aDate !== bDate) {
        return aDate.localeCompare(bDate);
      }

      const aCreated = a.created_date ?? '9999-12-31';
      const bCreated = b.created_date ?? '9999-12-31';
      return aCreated.localeCompare(bCreated);
    });
}

async function loadOpenOrders(
  supabase: SupabaseClient,
  options?: { customerName?: string | null; customerIds?: number[] | null }
) {
  let query = supabase
    .from('orders')
    .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)')
    .order('delivery_date', { ascending: true, nullsFirst: false })
    .order('order_id', { ascending: true });

  if (options?.customerIds && options.customerIds.length > 0) {
    query = query.in('customer_id', options.customerIds);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const openOrders = ((data ?? []) as OrderRow[])
    .map(mapOrderRowToSummaryRow)
    .filter(order => !isTerminalStatus(order.status_name));

  if (options?.customerName) {
    const normalizedName = normalizeCustomerReference(options.customerName);
    return openOrders.filter(
      order => normalizeCustomerReference(order.customer_name ?? '') === normalizedName
    );
  }

  return openOrders;
}

function mapOrderRows(rows: OrderRow[]) {
  return rows.map(mapOrderRowToSummaryRow);
}

async function loadCustomerMatches(supabase: SupabaseClient, customerRef: string) {
  const normalizedRef = customerRef.trim();
  if (!normalizedRef) {
    return [];
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id, name')
    .ilike('name', `%${escapeIlikeTerm(normalizedRef)}%`)
    .limit(CUSTOMER_QUERY_LIMIT);

  if (error) {
    throw error;
  }

  return ((data ?? []) as CustomerLookupRow[])
    .map(row => ({
      customer_id: row.id,
      name: row.name?.trim() ?? null,
    }))
    .filter((row): row is { customer_id: number; name: string } => Boolean(row.name));
}

async function loadOrderRows(supabase: SupabaseClient, orderRef?: string | null) {
  const normalizedRef = orderRef?.trim() ?? '';

  if (!normalizedRef) {
    const { data, error } = await supabase
      .from('orders')
      .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)')
      .order('order_id', { ascending: false })
      .limit(ORDER_QUERY_LIMIT);

    if (error) {
      throw error;
    }

    return mapOrderRows((data ?? []) as OrderRow[]);
  }

  const deduped = new Map<number, OrderRow>();
  const escapedRef = escapeIlikeTerm(normalizedRef);

  const { data: orderNumberRows, error: orderNumberError } = await supabase
    .from('orders')
    .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)')
    .ilike('order_number', `%${escapedRef}%`)
    .order('order_id', { ascending: false })
    .limit(ORDER_QUERY_LIMIT);

  if (orderNumberError) {
    throw orderNumberError;
  }

  for (const row of (orderNumberRows ?? []) as OrderRow[]) {
    deduped.set(row.order_id, row);
  }

  if (/^\d+$/.test(normalizedRef)) {
    const numericOrderId = Number.parseInt(normalizedRef, 10);
    const { data: directOrderRows, error: directOrderError } = await supabase
      .from('orders')
      .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)')
      .eq('order_id', numericOrderId)
      .limit(1);

    if (directOrderError) {
      throw directOrderError;
    }

    for (const row of (directOrderRows ?? []) as OrderRow[]) {
      deduped.set(row.order_id, row);
    }
  }

  const customerMatches = await loadCustomerMatches(supabase, normalizedRef);
  if (customerMatches.length > 0) {
    const { data: customerOrderRows, error: customerOrderError } = await supabase
      .from('orders')
      .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)')
      .in('customer_id', customerMatches.map(customer => customer.customer_id))
      .order('order_id', { ascending: false })
      .limit(ORDER_QUERY_LIMIT);

    if (customerOrderError) {
      throw customerOrderError;
    }

    for (const row of (customerOrderRows ?? []) as OrderRow[]) {
      deduped.set(row.order_id, row);
    }
  }

  return mapOrderRows(Array.from(deduped.values()));
}

function normalizeOrderReference(value: string) {
  return value.trim().toLowerCase();
}

function scoreOrderCandidate(
  row: { order_id: number; order_number: string | null; customer_name: string | null },
  orderRef: string
) {
  const ref = normalizeOrderReference(orderRef);
  const idText = String(row.order_id);
  const orderNumber = normalizeOrderReference(row.order_number ?? '');
  const customerName = normalizeOrderReference(row.customer_name ?? '');
  let score = 0;

  if (idText === ref) score += 150;
  if (orderNumber === ref) score += 140;
  if (orderNumber.startsWith(ref)) score += 80;
  if (orderNumber.includes(ref)) score += 65;
  if (customerName === ref) score += 60;
  if (customerName.includes(ref)) score += 35;

  return score;
}

function normalizeCustomerReference(value: string) {
  return value.trim().toLowerCase();
}

function cleanCustomerCandidate(value: string) {
  return value
    .replace(/^(customer\s+)/i, '')
    .replace(/\b(?:are there|do we have|right now|currently)$/i, '')
    .replace(/\b(?:placed|ordered)\s+(?:by|for)\s+/i, '')
    .trim();
}

function escapeIlikeTerm(value: string) {
  return value.replace(/[%_]/g, match => `\\${match}`);
}

function scoreCustomerCandidate(customerName: string, customerRef: string) {
  const name = normalizeCustomerReference(customerName);
  const ref = normalizeCustomerReference(customerRef);
  let score = 0;

  if (name === ref) score += 150;
  if (name.startsWith(ref)) score += 90;
  if (name.includes(ref)) score += 70;

  const refTokens = ref.split(/\s+/).filter(Boolean);
  const matchedTokens = refTokens.filter(token => name.includes(token)).length;
  if (refTokens.length > 0 && matchedTokens === refTokens.length) {
    score += 20 + matchedTokens * 5;
  }

  return score;
}

export async function resolveOrderReference(
  supabase: SupabaseClient,
  orderRef: string
): Promise<
  | { kind: 'resolved'; order: { order_id: number; order_number: string | null; customer_name: string | null; delivery_date: string | null; status_name: string | null } }
  | { kind: 'ambiguous'; order_ref: string; candidates: Array<{ order_id: number; order_number: string | null; customer_name: string | null }> }
  | { kind: 'not_found'; order_ref: string }
> {
  const normalizedRef = normalizeOrderReference(orderRef);
  if (!normalizedRef) {
    return { kind: 'not_found', order_ref: orderRef };
  }

  const orderRows = await loadOrderRows(supabase, orderRef);
  const scored = orderRows
    .map(row => ({ row, score: scoreOrderCandidate(row, normalizedRef) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top || top.score < 60) {
    return { kind: 'not_found', order_ref: orderRef };
  }

  const exactMatch =
    String(top.row.order_id) === normalizedRef ||
    normalizeOrderReference(top.row.order_number ?? '') === normalizedRef;

  if (!exactMatch && second && second.score >= top.score - 10) {
    return {
      kind: 'ambiguous',
      order_ref: orderRef,
      candidates: scored.slice(0, 4).map(item => ({
        order_id: item.row.order_id,
        order_number: item.row.order_number,
        customer_name: item.row.customer_name,
      })),
    };
  }

  return {
    kind: 'resolved',
    order: top.row,
  };
}

export async function getOpenCustomerOrdersSummary(
  supabase: SupabaseClient,
  customerName?: string | null
): Promise<AssistantOpenOrdersSummary> {
  const today = getCurrentDateInZone();
  const { week_end } = getWeekRange(today);
  const filteredOrders = customerName
    ? await loadOpenOrders(supabase, {
        customerIds: (await loadCustomerMatches(supabase, customerName)).map(customer => customer.customer_id),
        customerName,
      })
    : await loadOpenOrders(supabase);

  const statusBreakdownMap = new Map<string, number>();
  let overdueOrderCount = 0;
  let dueThisWeekCount = 0;
  let missingStatusCount = 0;

  for (const order of filteredOrders) {
    const statusLabel = order.status_name || 'Not set';
    statusBreakdownMap.set(statusLabel, (statusBreakdownMap.get(statusLabel) ?? 0) + 1);

    if (!order.status_name) {
      missingStatusCount += 1;
    }

    if (!order.delivery_date) {
      continue;
    }

    if (order.delivery_date < today) {
      overdueOrderCount += 1;
    }

    if (order.delivery_date >= today && order.delivery_date <= week_end) {
      dueThisWeekCount += 1;
    }
  }

  const nextDueOrders = await enrichOrderRows(
    supabase,
    filteredOrders
      .filter(order => order.delivery_date != null && order.delivery_date >= today)
      .slice(0, 5)
  );

  const listedOrders = await enrichOrderRows(
    supabase,
    filteredOrders.slice(0, 8)
  );

  return {
    customer_name: customerName?.trim() || null,
    open_order_count: filteredOrders.length,
    overdue_order_count: overdueOrderCount,
    due_this_week_count: dueThisWeekCount,
    missing_status_count: missingStatusCount,
    status_breakdown: Array.from(statusBreakdownMap.entries())
      .map(([status_name, count]) => ({ status_name, count }))
      .sort((a, b) => b.count - a.count),
    next_due_orders: nextDueOrders,
    listed_orders: listedOrders,
  };
}

export async function resolveOpenOrdersCustomer(
  supabase: SupabaseClient,
  customerRef: string
): Promise<AssistantOpenOrdersCustomerResolution> {
  const normalizedRef = normalizeCustomerReference(customerRef);
  if (!normalizedRef) {
    return { kind: 'not_found', customer_ref: customerRef };
  }

  const customerMatches = await loadCustomerMatches(supabase, customerRef);
  const uniqueCustomerNames = Array.from(
    new Set(customerMatches.map(customer => customer.name))
  );

  const scored = uniqueCustomerNames
    .map(customerName => ({
      customer_name: customerName,
      score: scoreCustomerCandidate(customerName, normalizedRef),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const [top, second] = scored;
  if (!top || top.score < 70) {
    return { kind: 'not_found', customer_ref: customerRef };
  }

  if (second && second.score >= top.score - 10) {
    return {
      kind: 'ambiguous',
      customer_ref: customerRef,
      candidates: scored.slice(0, 4).map(item => item.customer_name),
    };
  }

  return {
    kind: 'resolved',
    customer_name: top.customer_name,
  };
}

export async function getOrdersDueThisWeekSummary(
  supabase: SupabaseClient,
  customerName?: string | null
): Promise<AssistantDueThisWeekSummary> {
  const today = getCurrentDateInZone();
  const { week_start, week_end } = getWeekRange(today);
  const filteredOrders = customerName
    ? await loadOpenOrders(supabase, {
        customerIds: (await loadCustomerMatches(supabase, customerName)).map(customer => customer.customer_id),
        customerName,
      })
    : await loadOpenOrders(supabase);

  const dueOrders = filteredOrders.filter(
    order => order.delivery_date != null && order.delivery_date >= today && order.delivery_date <= week_end
  );

  const enrichedDueOrders = await enrichOrderRows(
    supabase,
    dueOrders.slice(0, 8)
  );

  return {
    customer_name: customerName?.trim() || null,
    week_start,
    week_end,
    due_order_count: dueOrders.length,
    orders: enrichedDueOrders,
  };
}

export async function getOrdersLast7DaysSummary(
  supabase: SupabaseClient,
  customerName?: string | null
): Promise<AssistantOrdersLast7DaysSummary> {
  const today = getCurrentDateInZone();
  const { range_start, range_end } = getRecentDayRange(today, 7);
  const rangeEndExclusive = addDays(range_end, 1);
  const customerIds = customerName
    ? (await loadCustomerMatches(supabase, customerName)).map(customer => customer.customer_id)
    : null;

  let query = supabase
    .from('orders')
    .select('order_id, customer_id, order_number, created_at, delivery_date, customer:customers(name), quote:quotes(id, quote_number)')
    .gte('created_at', `${range_start}T00:00:00+02:00`)
    .lt('created_at', `${rangeEndExclusive}T00:00:00+02:00`)
    .order('created_at', { ascending: false });

  if (customerIds && customerIds.length > 0) {
    query = query.in('customer_id', customerIds);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const recentOrders = await enrichOrderRows(
    supabase,
    ((data ?? []) as OrderRow[]).map(mapOrderRowToSummaryRow)
  );

  const dailyCountMap = new Map<string, number>();
  for (let offset = 0; offset < 7; offset += 1) {
    dailyCountMap.set(addDays(range_start, offset), 0);
  }

  for (const order of recentOrders) {
    if (!order.created_date || !dailyCountMap.has(order.created_date)) {
      continue;
    }

    dailyCountMap.set(order.created_date, (dailyCountMap.get(order.created_date) ?? 0) + 1);
  }

  const dailyCounts = Array.from(dailyCountMap.entries()).map(([date, count]) => ({
    date,
    label: formatDayLabel(date),
    count,
  }));

  const busiestDay = dailyCounts.reduce<AssistantOrdersLast7DaysSummary['busiest_day']>(
    (currentBest, point) => {
      if (!currentBest || point.count > currentBest.count) {
        return {
          date: point.date,
          count: point.count,
        };
      }

      return currentBest;
    },
    null
  );

  return {
    customer_name: customerName?.trim() || null,
    range_start,
    range_end,
    total_order_count: recentOrders.length,
    average_per_day: recentOrders.length / 7,
    busiest_day: busiestDay,
    daily_counts: dailyCounts,
    recent_orders: recentOrders.slice(0, 15),
  };
}

export async function getLastCustomerOrderSummary(
  supabase: SupabaseClient,
  customerName: string
): Promise<AssistantLastCustomerOrderSummary> {
  const customerIds = (await loadCustomerMatches(supabase, customerName)).map(
    customer => customer.customer_id
  );

  if (customerIds.length === 0) {
    return {
      customer_name: customerName,
      latest_order: null,
      recent_orders: [],
    };
  }

  const { data, error } = await supabase
    .from('orders')
    .select(
      'order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name), quote:quotes(id, quote_number)'
    )
    .in('customer_id', customerIds)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    throw error;
  }

  const recentOrders = await enrichOrderRows(
    supabase,
    ((data ?? []) as OrderRow[]).map(mapOrderRowToSummaryRow)
  );

  return {
    customer_name: customerName.trim(),
    latest_order: recentOrders[0] ?? null,
    recent_orders: recentOrders,
  };
}

export async function getOrderProductsSummary(
  supabase: SupabaseClient,
  orderRef: string
): Promise<AssistantOrderProductsSummary> {
  const resolved = await resolveOrderReference(supabase, orderRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const { data, error } = await supabase
    .from('order_details')
    .select('order_detail_id, quantity, product:products(name, internal_code)')
    .eq('order_id', resolved.order.order_id)
    .order('order_detail_id', { ascending: true });

  if (error) {
    throw error;
  }

  const products = ((data ?? []) as OrderProductDetailRow[]).map(row => {
    const product = getRelationRecord(row.product);
    const code = product?.internal_code?.trim() || null;
    const name = product?.name?.trim() || null;
    return {
      order_detail_id: row.order_detail_id,
      product_label: code && name && code !== name ? `${name} (${code})` : name || code || `Product ${row.order_detail_id}`,
      quantity: toNumber(row.quantity),
    };
  });

  return {
    kind: 'summary',
    order: resolved.order,
    line_count: products.length,
    total_quantity: products.reduce((sum, row) => sum + row.quantity, 0),
    products,
  };
}

export async function getProductOpenOrdersSummary(
  supabase: SupabaseClient,
  productRef: string
): Promise<AssistantProductOpenOrdersSummary> {
  const resolved = await resolveAssistantProduct(supabase, productRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const today = getCurrentDateInZone();
  const { week_end } = getWeekRange(today);
  const orders = await loadOpenOrdersForProduct(supabase, resolved.product.product_id);

  let overdueOrderCount = 0;
  let dueThisWeekCount = 0;
  let totalQuantity = 0;

  for (const order of orders) {
    totalQuantity += order.quantity;

    if (!order.delivery_date) {
      continue;
    }

    if (order.delivery_date < today) {
      overdueOrderCount += 1;
    }

    if (order.delivery_date >= today && order.delivery_date <= week_end) {
      dueThisWeekCount += 1;
    }
  }

  return {
    kind: 'summary',
    product: resolved.product,
    open_order_count: orders.length,
    total_quantity: totalQuantity,
    overdue_order_count: overdueOrderCount,
    due_this_week_count: dueThisWeekCount,
    orders: orders.slice(0, 8),
  };
}

export async function getOrderSearchSummary(
  supabase: SupabaseClient,
  searchTerm: string,
  matchMode: 'starts_with' | 'contains'
): Promise<AssistantOrderSearchSummary> {
  const normalizedTerm = searchTerm.trim();
  if (!normalizedTerm) {
    return {
      query_term: searchTerm,
      match_mode: matchMode,
      order_count: 0,
      orders: [],
    };
  }

  let query = supabase
    .from('orders')
    .select(
      'order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)'
    )
    .not('order_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(8);

  const escapedTerm = escapeIlikeTerm(normalizedTerm);
  query =
    matchMode === 'starts_with'
      ? query.ilike('order_number', `${escapedTerm}%`)
      : query.ilike('order_number', `%${escapedTerm}%`);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const orders = await enrichOrderRows(
    supabase,
    ((data ?? []) as OrderRow[]).map(mapOrderRowToSummaryRow)
  );

  return {
    query_term: normalizedTerm,
    match_mode: matchMode,
    order_count: orders.length,
    orders,
  };
}

export async function getLateOrdersSummary(
  supabase: SupabaseClient,
  customerName?: string | null
): Promise<AssistantLateOrdersSummary> {
  const today = getCurrentDateInZone();
  const filteredOrders = customerName
    ? await loadOpenOrders(supabase, {
        customerIds: (await loadCustomerMatches(supabase, customerName)).map(customer => customer.customer_id),
        customerName,
      })
    : await loadOpenOrders(supabase);

  const lateOrders = filteredOrders
    .filter(order => order.delivery_date != null && order.delivery_date < today)
    .map(order => ({
      ...order,
      days_late: differenceInDaysFromDateOnly(order.delivery_date!, today),
    }))
    .sort((a, b) => b.days_late - a.days_late)
    .slice(0, 8);

  const enrichedLateOrders = (await enrichOrderRows(
    supabase,
    lateOrders
  )).map(order => ({
    ...order,
    days_late: lateOrders.find(candidate => candidate.order_id === order.order_id)?.days_late ?? 0,
  }));

  return {
    customer_name: customerName?.trim() || null,
    late_order_count: filteredOrders.filter(order => order.delivery_date != null && order.delivery_date < today)
      .length,
    late_orders: enrichedLateOrders,
  };
}

export async function getLowStockSummary(supabase: SupabaseClient): Promise<AssistantLowStockSummary> {
  const { data, error } = await supabase
    .from('inventory')
    .select('inventory_id, quantity_on_hand, reorder_level, component:components(internal_code, description)')
    .gt('reorder_level', 0)
    .order('quantity_on_hand', { ascending: true });

  if (error) {
    throw error;
  }

  const items = ((data ?? []) as InventoryRow[])
    .map(row => {
      const component = getRelationRecord(row.component);
      const quantityOnHand = toNumber(row.quantity_on_hand);
      const reorderLevel = toNumber(row.reorder_level);
      return {
        inventory_id: row.inventory_id,
        internal_code: component?.internal_code?.trim() || `Inventory ${row.inventory_id}`,
        description: component?.description?.trim() || null,
        quantity_on_hand: quantityOnHand,
        reorder_level: reorderLevel,
        shortage_qty: Math.max(reorderLevel - quantityOnHand, 0),
      };
    })
    .filter(item => item.reorder_level > 0 && item.quantity_on_hand <= item.reorder_level);

  return {
    low_stock_count: items.length,
    items: items.slice(0, 8),
  };
}

export async function getOrderBlockerSummary(
  supabase: SupabaseClient,
  orderRef: string
): Promise<AssistantOrderBlockerSummary> {
  const resolved = await resolveOrderReference(supabase, orderRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const { data, error } = await supabase.rpc('get_detailed_component_status', {
    p_order_id: resolved.order.order_id,
  });

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as OrderStatusRpcRow[]).map(row => ({
    internal_code: row.internal_code?.trim() || `Component ${row.component_id ?? '?'}`,
    description: row.description?.trim() || null,
    required: toNumber(row.order_required),
    in_stock: toNumber(row.in_stock),
    on_order: toNumber(row.on_order),
    apparent_shortfall: toNumber(row.apparent_shortfall),
    shortfall: toNumber(row.real_shortfall),
  }));

  const blockedItems = rows
    .filter(item => item.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall);
  const waitingItems = rows
    .filter(item => item.apparent_shortfall > 0 && item.shortfall <= 0)
    .sort((a, b) => b.apparent_shortfall - a.apparent_shortfall);
  const readyComponents = rows.length - blockedItems.length - waitingItems.length;

  return {
    kind: 'summary',
    order: resolved.order,
    blocked_components: blockedItems.length,
    waiting_on_deliveries_components: waitingItems.length,
    ready_components: Math.max(readyComponents, 0),
    blocked_items: blockedItems.slice(0, 5),
    waiting_items: waitingItems.slice(0, 5),
  };
}

export function detectOperationalIntent(message: string): AssistantOperationalIntent | null {
  const normalized = message.toLowerCase();

  if (
    /\b(products?|items?)\b/.test(normalized) &&
    /\b(on|for)\s+order\b|\border\b/.test(normalized) &&
    /\b(what|which|show|list)\b/.test(normalized)
  ) {
    return 'order_products';
  }

  if (
    /\b(?:customer\s+)?orders?\b/.test(normalized) &&
    /\b(include|includes|contain|contains|for)\b/.test(normalized) &&
    !/\b(start(?:s|ing)? with|contain(?:s|ing)?\s+(?:the\s+word|the\s+name|name|word)?|matching|match|begin(?:s|ning)? with)\b/.test(
      normalized
    )
  ) {
    return 'product_open_orders';
  }

  if (
    /\b(last|latest|recent)\b/.test(normalized) &&
    /\borders\b/.test(normalized) &&
    /\b(by|for|from)\b/.test(normalized) &&
    !/\b(last 7 days|past 7 days|last week|this week so far)\b/.test(normalized)
  ) {
    return 'recent_customer_orders';
  }

  if (
    /\b(order|orders)\b/.test(normalized) &&
    /\b(start(?:s|ing)? with|contain(?:s|ing)?|matching|match|begin(?:s|ning)? with)\b/.test(normalized)
  ) {
    return 'order_search';
  }

  if (
    /\b(last|latest|most recent)\b/.test(normalized) &&
    /\border\b/.test(normalized) &&
    !/\b(last 7 days|past 7 days|last week|this week so far)\b/.test(normalized)
  ) {
    return 'last_customer_order';
  }

  if (
    /\b(last 7 days|past 7 days|last week|this week so far)\b/.test(normalized) &&
    /\b(order|orders)\b/.test(normalized)
  ) {
    return 'orders_last_7_days';
  }

  if (/\b(low stock|below reorder|below reorder level|reorder level|need to reorder|needs reordering)\b/.test(normalized)) {
    return 'low_stock';
  }

  if (/\b(late orders|overdue orders|which orders are late|which customer orders are late)\b/.test(normalized)) {
    return 'late_orders';
  }

  if (/\b(order|orders)\b/.test(normalized) && /\bdue this week\b/.test(normalized)) {
    return 'orders_due_this_week';
  }

  if (
    /\b(blocking order|what is blocking order|what's blocking order|blocked order|order blocker)\b/.test(normalized) ||
    (/\b(order|orders)\b/.test(normalized) &&
      /\b(still owing|outstanding parts?|supplier parts?|components?)\b/.test(normalized) &&
      /\b(owing|outstanding|left|still|waiting|from suppliers?|deliver(?:ed|ies|y)?)\b/.test(normalized))
  ) {
    return 'order_blockers';
  }

  if (
    /\b(open|outstanding)\b/.test(normalized) &&
    /\borders?\b/.test(normalized) &&
    /\b(how many|count|what|show|list|have|currently|can you)\b/.test(normalized)
  ) {
    return 'open_orders';
  }

  if (
    /\b(open customer orders|open orders|customer orders)\b/.test(normalized) &&
    /\b(how many|count|what(?:'s| is)|show|list)\b/.test(normalized)
  ) {
    return 'open_orders';
  }

  return null;
}

export function extractProductOpenOrdersReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:which|what|show|list)\s+(?:customer\s+)?orders?\s+(?:include|includes|contain|contains|for)\s+(.+)$/i,
    /\b(?:do we have|are there|is there)\s+any\s+(.+?)\s+(?:on order|in order|ordered)(?:\s+at the moment|\s+right now|\s+currently)?$/i,
    /\bhow many\s+(.+?)\s+(?:are|do we have)?\s*(?:on order|in order|ordered)(?:\s+at the moment|\s+right now|\s+currently)?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate
        .replace(/^(?:the|a|an)\s+/i, '')
        .replace(/\b(?:from customers|for customers|customer orders?)$/i, '')
        .trim();
    }
  }

  return null;
}

export function extractOrderProductsReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:what|which|show|list)\s+(?:products|product|items|item)\s+(?:are\s+)?(?:on|for)\s+order\s+(.+)$/i,
    /\b(?:what|which|show|list)\s+(?:products|product|items|item)\s+(?:are\s+)?(?:on|for)\s+(.+?)\s+order$/i,
    /\b(?:what|which|show|list)\s+(?:products|product|items|item)\s+(?:are\s+)?(?:on|for)\s+this\s+order\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      const cleaned = candidate.replace(/^(?:order\s+)/i, '').trim();
      if (/^(?:this|that)$/i.test(cleaned)) {
        return null;
      }
      return cleaned;
    }
  }

  return null;
}

export function extractOpenOrdersCustomerReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:what|which|show|list)\s+(?:open|outstanding)\s+(.+?)\s+orders(?:\s+do\s+we\s+have)?$/i,
    /\b(?:how many\s+)?(?:open|outstanding)\s+(.+?)\s+orders(?:\s+do\s+we\s+have)?$/i,
    /\b(?:can you\s+)?list\s+(?:the\s+)?(?:open|outstanding)\s+(.+?)\s+orders$/i,
    /\b(?:how many\s+)?(?:late orders|overdue orders)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:how many\s+)?(?:late orders|overdue orders)\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\b(?:which orders are due this week|orders due this week)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:which orders are due this week|orders due this week)\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\b(?:open customer orders|open orders|customer orders)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:open customer orders|open orders|customer orders)\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\bhow many\s+(?:open customer orders|open orders|customer orders)\s+(?:for|from)\s+(.+)$/i,
    /\bhow many\s+(?:open customer orders|open orders|customer orders)\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\b(?:for|from)\s+(.+?)\s+(?:which orders are due this week|orders due this week)\b/i,
    /\b(?:placed|ordered)\s+(?:by|for)\s+(.+?)\s+(?:which orders are due this week|orders due this week)\b/i,
    /\b(?:for|from)\s+(.+?)\s+(?:late orders|overdue orders)\b/i,
    /\b(?:placed|ordered)\s+(?:by|for)\s+(.+?)\s+(?:late orders|overdue orders)\b/i,
    /\b(?:for|from)\s+(.+?)\s+(?:how many\s+)?(?:open customer orders|open orders|customer orders)\b/i,
    /\b(?:placed|ordered)\s+(?:by|for)\s+(.+?)\s+(?:how many\s+)?(?:open customer orders|open orders|customer orders)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return cleanCustomerCandidate(candidate);
    }
  }

  return null;
}

export function extractRecentOrdersCustomerReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:orders|customer orders)\s+(?:from|in)\s+(?:the\s+)?(?:last 7 days|past 7 days|last week)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:orders|customer orders)\s+(?:from|in)\s+(?:the\s+)?(?:last 7 days|past 7 days|last week)\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\b(?:for|from)\s+(.+?)\s+(?:orders|customer orders)\s+(?:from|in)\s+(?:the\s+)?(?:last 7 days|past 7 days|last week)\b/i,
    /\b(?:placed|ordered)\s+(?:by|for)\s+(.+?)\s+(?:orders|customer orders)\s+(?:from|in)\s+(?:the\s+)?(?:last 7 days|past 7 days|last week)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return cleanCustomerCandidate(candidate);
    }
  }

  return null;
}

export function extractLatestOrderCustomerReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:last|latest|most recent)\s+(?:customer\s+)?order\s+(?:for|from)\s+(.+)$/i,
    /\b(?:last|latest|most recent)\s+(?:customer\s+)?order\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\bwhat\s+was\s+the\s+(?:last|latest|most recent)\s+(?:customer\s+)?order\s+(?:for|from)\s+(.+)$/i,
    /\bwhat\s+was\s+the\s+(?:last|latest|most recent)\s+(?:customer\s+)?order\s+(?:placed|ordered)\s+(?:by|for)\s+(.+)$/i,
    /\b(?:for|from)\s+(.+?)\s+(?:what\s+was\s+the\s+)?(?:last|latest|most recent)\s+(?:customer\s+)?order\b/i,
    /\b(?:placed|ordered)\s+(?:by|for)\s+(.+?)\s+(?:what\s+was\s+the\s+)?(?:last|latest|most recent)\s+(?:customer\s+)?order\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return cleanCustomerCandidate(candidate);
    }
  }

  return null;
}

export function extractRecentCustomerOrdersCustomerReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:last|latest|recent)\s+orders?\s+(?:placed\s+)?(?:for|from|by)\s+(.+)$/i,
    /\b(?:last|latest|recent)\s+orders?\s+(?:ordered)\s+(?:for|from|by)\s+(.+)$/i,
    /\b(?:for|from|by)\s+(.+?)\s+(?:last|latest|recent)\s+orders?\b/i,
    /\b(?:placed|ordered)\s+(?:by|for)\s+(.+?)\s+(?:last|latest|recent)\s+orders?\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return cleanCustomerCandidate(candidate);
    }
  }

  return null;
}

export function detectOrderSearchMode(message: string): 'starts_with' | 'contains' {
  const normalized = message.toLowerCase();
  if (/\b(start(?:s|ing)? with|begin(?:s|ning)? with)\b/.test(normalized)) {
    return 'starts_with';
  }

  return 'contains';
}

export function extractOrderSearchReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:order|orders)\s+(?:that\s+)?(?:start|starts|starting|begin|begins|beginning)\s+with\s+(?:the\s+word\s+|the\s+name\s+|name\s+|word\s+)?["']?([^"']+)["']?$/i,
    /\b(?:order|orders)\s+(?:that\s+)?contain(?:s|ing)?\s+(?:the\s+word\s+|the\s+name\s+|name\s+|word\s+)?["']?([^"']+)["']?$/i,
    /\b(?:find|show|list|which|what)\s+(?:customer\s+)?orders?\s+(?:matching|match)\s+["']?([^"']+)["']?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate
        .replace(/^(?:with\s+)?(?:the\s+word|the\s+name|word|name)\s+/i, '')
        .replace(/^(?:with\s+)+/i, '')
        .replace(/\b(?:the\s+word|the\s+name|word|name)\b/gi, '')
        .trim();
    }
  }

  return null;
}

export function shouldListOpenOrders(message: string) {
  const normalized = message.toLowerCase().replace(/[?]/g, ' ').replace(/\s+/g, ' ').trim();

  const mentionsOpenOrders =
    /\b(open customer orders|open orders|customer orders)\b/.test(normalized) ||
    /\b(what|which|show|list)\s+orders?\b/.test(normalized) && /\bopen\b/.test(normalized);

  if (!mentionsOpenOrders) {
    return false;
  }

  if (/\b(how many|count|total|number of)\b/.test(normalized)) {
    return false;
  }

  return /\b(show|list|which|display)\b/.test(normalized);
}

export function buildOpenOrdersAnswer(
  summary: AssistantOpenOrdersSummary,
  options?: { detailed?: boolean }
) {
  if (summary.open_order_count === 0) {
    return summary.customer_name
      ? `There are no open customer orders for ${summary.customer_name} right now.`
      : 'There are no open customer orders right now.';
  }

  return summary.customer_name
    ? options?.detailed
      ? `Here are the current open orders for ${summary.customer_name}.`
      : `Here is the current open-order summary for ${summary.customer_name}.`
    : options?.detailed
      ? 'Here are the current open customer orders.'
      : 'Here is the current open-order summary.';
}

export function buildOpenOrdersCard(
  summary: AssistantOpenOrdersSummary,
  options?: { detailed?: boolean }
): AssistantCard {
  const rowSource = options?.detailed
    ? summary.listed_orders
    : summary.next_due_orders.length > 0
      ? summary.next_due_orders
      : summary.listed_orders;
  const usingListedFallback = !options?.detailed && summary.next_due_orders.length === 0;
  const rows = rowSource.map(order => ({
    order: order.order_number?.trim() || `Order ${order.order_id}`,
    customer: order.customer_name?.trim() || 'Unknown customer',
    due_date: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
    status: order.status_name?.trim() || 'Not set',
  }));

  return {
    type: 'table',
    title: summary.customer_name ? `Open orders for ${summary.customer_name}` : 'Open customer orders',
    description: options?.detailed || usingListedFallback
      ? 'Current open orders matching this request.'
      : 'Next due open customer orders.',
    metrics: [
      {
        label: 'Open orders',
        value: formatNumber(summary.open_order_count),
      },
      {
        label: 'Due this week',
        value: formatNumber(summary.due_this_week_count),
      },
      {
        label: 'Overdue',
        value: formatNumber(summary.overdue_order_count),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'customer', label: 'Customer' },
      { key: 'due_date', label: 'Due date' },
      { key: 'status', label: 'Status' },
    ],
    rows,
    rowActions: rowSource.map(buildOrderQuickActions),
    footer: options?.detailed || usingListedFallback
      ? summary.open_order_count > rows.length
        ? 'Use Open, Client docs, or Quote to jump into the matching orders. Only a sample is shown here.'
        : 'Use Open, Client docs, or Quote to jump into the matching orders.'
      : 'Showing the next due open orders. Use the quick actions to open the order, client docs, or quote.',
  };
}

export function buildDueThisWeekAnswer(summary: AssistantDueThisWeekSummary) {
  const lines = [
    summary.customer_name
      ? `Orders due this week for ${summary.customer_name} (${formatDateForAnswer(summary.week_start)} to ${formatDateForAnswer(summary.week_end)}): ${formatNumber(summary.due_order_count)}`
      : `Orders due this week (${formatDateForAnswer(summary.week_start)} to ${formatDateForAnswer(summary.week_end)}): ${formatNumber(summary.due_order_count)}`,
  ];

  if (summary.orders.length > 0) {
    lines.push('');
    lines.push('Due this week:');
    for (const order of summary.orders) {
      lines.push(`- ${buildOrderLabel(order)}`);
    }
  } else {
    lines.push('No open customer orders are due in the current week.');
  }

  return lines.join('\n');
}

export function buildOrdersLast7DaysAnswer(summary: AssistantOrdersLast7DaysSummary) {
  const lines = [
    summary.customer_name
      ? `Orders created in the last 7 days for ${summary.customer_name}: ${formatNumber(summary.total_order_count)}`
      : `Orders created in the last 7 days: ${formatNumber(summary.total_order_count)}`,
    `Average per day: ${formatNumber(summary.average_per_day)}`,
  ];

  if (summary.busiest_day) {
    lines.push(
      `Busiest day: ${formatDateForAnswer(summary.busiest_day.date)} (${formatNumber(summary.busiest_day.count)})`
    );
  }

  if (summary.recent_orders.length > 0) {
    lines.push('');
    lines.push('Most recent orders:');
    for (const order of summary.recent_orders.slice(0, 5)) {
      const orderLabel = order.order_number?.trim() || `Order ${order.order_id}`;
      const customerLabel = order.customer_name?.trim() || 'Unknown customer';
      const createdLabel = order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date';
      lines.push(`- ${orderLabel} (${customerLabel}) created ${createdLabel}`);
    }
  } else {
    lines.push('');
    lines.push('No orders were created in this period.');
  }

  return lines.join('\n');
}

export function buildLastCustomerOrderAnswer(summary: AssistantLastCustomerOrderSummary) {
  if (!summary.latest_order) {
    return `I don't know of any orders for ${summary.customer_name} yet.`;
  }

  const latestOrder = summary.latest_order;
  const lines = [
    `Latest order for ${summary.customer_name}: ${latestOrder.order_number?.trim() || `Order ${latestOrder.order_id}`}`,
    `Created: ${latestOrder.created_date ? formatDateForAnswer(latestOrder.created_date) : 'Unknown date'}`,
    `Status: ${latestOrder.status_name?.trim() || 'Not set'}`,
  ];

  if (latestOrder.delivery_date) {
    lines.push(`Delivery date: ${formatDateForAnswer(latestOrder.delivery_date)}`);
  }

  if (summary.recent_orders.length > 1) {
    lines.push('');
    lines.push('Recent orders:');
    for (const order of summary.recent_orders.slice(0, 3)) {
      lines.push(
        `- ${order.order_number?.trim() || `Order ${order.order_id}`} | ${
          order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date'
        }`
      );
    }
  }

  return lines.join('\n');
}

export function buildLastCustomerOrderCard(summary: AssistantLastCustomerOrderSummary): AssistantCard | undefined {
  if (!summary.latest_order) {
    return undefined;
  }

  return {
    type: 'table',
    title: `Latest order for ${summary.customer_name}`,
    description: 'Most recent customer orders by creation date.',
    metrics: [
      {
        label: 'Latest order',
        value: summary.latest_order.order_number?.trim() || `Order ${summary.latest_order.order_id}`,
      },
      {
        label: 'Created',
        value: summary.latest_order.created_date
          ? formatDateForAnswer(summary.latest_order.created_date)
          : 'Unknown date',
      },
      {
        label: 'Status',
        value: summary.latest_order.status_name?.trim() || 'Not set',
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'created', label: 'Created' },
      { key: 'delivery', label: 'Delivery' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.recent_orders.map(order => ({
      order: order.order_number?.trim() || `Order ${order.order_id}`,
      created: order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date',
      delivery: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
      status: order.status_name?.trim() || 'Not set',
    })),
    rowActions: summary.recent_orders.map(buildOrderQuickActions),
    footer:
      summary.recent_orders.length > 0
        ? 'Use Open, Client docs, or Quote to jump straight into the latest order.'
        : undefined,
  };
}

export function buildProductOpenOrdersAnswer(summary: AssistantProductOpenOrdersSummary) {
  if (summary.kind === 'ambiguous') {
    const options = summary.candidates
      .map(candidate => `- ${formatAssistantProductLabel(candidate)}`)
      .join('\n');
    return `I found multiple possible products for "${summary.product_ref}". Which one did you mean?\n${options}`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find a product matching "${summary.product_ref}" in Unity.`;
  }

  const productLabel = formatAssistantProductLabel(summary.product);
  if (summary.open_order_count === 0) {
    return `${productLabel} is not currently on any open customer orders.`;
  }

  const lines = [
    `${productLabel} is on ${formatNumber(summary.open_order_count)} open customer order${summary.open_order_count === 1 ? '' : 's'}.`,
    `Total quantity on open orders: ${formatNumber(summary.total_quantity)}`,
    `Due this week: ${formatNumber(summary.due_this_week_count)}`,
    `Overdue: ${formatNumber(summary.overdue_order_count)}`,
  ];

  if (summary.orders.length > 0) {
    lines.push('');
    lines.push('Matching open orders:');
    for (const order of summary.orders.slice(0, 4)) {
      lines.push(
        `- ${order.order_number?.trim() || `Order ${order.order_id}`} | ${order.customer_name?.trim() || 'Unknown customer'} | qty ${formatNumber(order.quantity)}`
      );
    }
  }

  return lines.join('\n');
}

export function buildProductOpenOrdersCard(
  summary: Extract<AssistantProductOpenOrdersSummary, { kind: 'summary' }>
): AssistantCard {
  return {
    type: 'table',
    title: `Customer orders for ${formatAssistantProductLabel(summary.product)}`,
    description: 'Open customer orders that currently include this manufactured product.',
    metrics: [
      {
        label: 'Open orders',
        value: formatNumber(summary.open_order_count),
      },
      {
        label: 'Qty on order',
        value: formatNumber(summary.total_quantity),
      },
      {
        label: 'Due this week',
        value: formatNumber(summary.due_this_week_count),
      },
      {
        label: 'Overdue',
        value: formatNumber(summary.overdue_order_count),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'customer', label: 'Customer' },
      { key: 'qty', label: 'Qty', align: 'right' },
      { key: 'due_date', label: 'Due date' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.orders.map(order => ({
      order: order.order_number?.trim() || `Order ${order.order_id}`,
      customer: order.customer_name?.trim() || 'Unknown customer',
      qty: formatNumber(order.quantity),
      due_date: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
      status: order.status_name?.trim() || 'Not set',
    })),
    rowActions: summary.orders.map(buildOrderQuickActions),
    footer:
      summary.orders.length > 0
        ? 'Use Open, Client docs, or Quote to jump into the matching customer orders.'
        : 'No open customer orders currently include this product.',
  };
}

export function buildOrderProductsAnswer(summary: AssistantOrderProductsSummary) {
  if (summary.kind === 'ambiguous') {
    const options = summary.candidates
      .map(candidate => `- ${candidate.order_number?.trim() || `Order ${candidate.order_id}`}${candidate.customer_name ? ` (${candidate.customer_name})` : ''}`)
      .join('\n');
    return `I found multiple possible orders for "${summary.order_ref}". Which one did you mean?\n${options}`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find an order matching "${summary.order_ref}" in Unity.`;
  }

  const orderLabel = summary.order.order_number?.trim() || `Order ${summary.order.order_id}`;
  const lines = [
    `Products on ${orderLabel}: ${formatNumber(summary.line_count)}`,
    `Total quantity: ${formatNumber(summary.total_quantity)}`,
  ];

  if (summary.products.length > 0) {
    lines.push('');
    lines.push('Products:');
    for (const product of summary.products.slice(0, 6)) {
      lines.push(`- ${product.product_label} | qty ${formatNumber(product.quantity)}`);
    }
  } else {
    lines.push('No product lines are currently recorded on this order.');
  }

  return lines.join('\n');
}

export function buildOrderProductsCard(
  summary: Extract<AssistantOrderProductsSummary, { kind: 'summary' }>
): AssistantCard {
  return {
    type: 'table',
    title: `Products on ${summary.order.order_number?.trim() || `Order ${summary.order.order_id}`}`,
    description: 'Product lines currently recorded on this customer order.',
    metrics: [
      { label: 'Product lines', value: formatNumber(summary.line_count) },
      { label: 'Total qty', value: formatNumber(summary.total_quantity) },
      { label: 'Status', value: summary.order.status_name?.trim() || 'Not set' },
    ],
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'qty', label: 'Qty', align: 'right' },
    ],
    rows: summary.products.map(product => ({
      product: product.product_label,
      qty: formatNumber(product.quantity),
    })),
    actions: [
      {
        label: 'Preview order',
        kind: 'preview_order',
        orderId: summary.order.order_id,
      },
      {
        label: 'Open order',
        kind: 'navigate',
        href: `/orders/${summary.order.order_id}`,
      },
      {
        label: 'Job cards',
        kind: 'ask',
        prompt: `What job cards are on order ${summary.order.order_number?.trim() || summary.order.order_id}?`,
      },
      {
        label: 'Outstanding parts',
        kind: 'ask',
        prompt: `What is blocking order ${summary.order.order_number?.trim() || summary.order.order_id}?`,
      },
    ],
    footer:
      summary.products.length > 0
        ? 'Use Job cards or Outstanding parts to keep drilling into this order.'
        : 'No product lines are currently recorded for this order.',
  };
}

export function buildRecentCustomerOrdersAnswer(summary: AssistantLastCustomerOrderSummary) {
  if (summary.recent_orders.length === 0) {
    return `I don't know of any orders for ${summary.customer_name} yet.`;
  }

  const lines = [`Most recent orders for ${summary.customer_name}: ${formatNumber(summary.recent_orders.length)}`];
  lines.push('');
  lines.push('Recent orders:');

  for (const order of summary.recent_orders.slice(0, 5)) {
    lines.push(
      `- ${order.order_number?.trim() || `Order ${order.order_id}`} | ${
        order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date'
      } | ${order.status_name?.trim() || 'Not set'}`
    );
  }

  return lines.join('\n');
}

export function buildRecentCustomerOrdersCard(
  summary: AssistantLastCustomerOrderSummary
): AssistantCard | undefined {
  if (summary.recent_orders.length === 0) {
    return undefined;
  }

  return {
    type: 'table',
    title: `Recent orders for ${summary.customer_name}`,
    description: 'Newest matching customer orders by creation date.',
    metrics: [
      {
        label: 'Shown',
        value: formatNumber(summary.recent_orders.length),
      },
      {
        label: 'Latest order',
        value:
          summary.latest_order?.order_number?.trim() ||
          (summary.latest_order ? `Order ${summary.latest_order.order_id}` : '—'),
      },
      {
        label: 'Latest created',
        value: summary.latest_order?.created_date
          ? formatDateForAnswer(summary.latest_order.created_date)
          : 'Unknown date',
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'created', label: 'Created' },
      { key: 'delivery', label: 'Delivery' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.recent_orders.map(order => ({
      order: order.order_number?.trim() || `Order ${order.order_id}`,
      created: order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date',
      delivery: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
      status: order.status_name?.trim() || 'Not set',
    })),
    rowActions: summary.recent_orders.map(buildOrderQuickActions),
    footer: 'Use Open, Client docs, or Quote to jump into the latest matching orders.',
  };
}

export function buildOrderSearchAnswer(summary: AssistantOrderSearchSummary) {
  const modeLabel =
    summary.match_mode === 'starts_with' ? 'start with' : 'contain';
  const lines = [
    `Orders that ${modeLabel} "${summary.query_term}": ${formatNumber(summary.order_count)}`,
  ];

  if (summary.orders.length > 0) {
    lines.push('');
    lines.push('Matches:');
    for (const order of summary.orders.slice(0, 5)) {
      lines.push(
        `- ${order.order_number?.trim() || `Order ${order.order_id}`} | ${
          order.customer_name?.trim() || 'Unknown customer'
        } | ${order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date'}`
      );
    }
  } else {
    lines.push('No matching orders were found.');
  }

  return lines.join('\n');
}

export function buildOrderSearchCard(summary: AssistantOrderSearchSummary): AssistantCard {
  return {
    type: 'table',
    title:
      summary.match_mode === 'starts_with'
        ? `Orders starting with "${summary.query_term}"`
        : `Orders containing "${summary.query_term}"`,
    description: 'Matching order numbers from live Unity order data.',
    metrics: [
      {
        label: 'Matches',
        value: formatNumber(summary.order_count),
      },
      {
        label: 'Mode',
        value: summary.match_mode === 'starts_with' ? 'Starts with' : 'Contains',
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'customer', label: 'Customer' },
      { key: 'created', label: 'Created' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.orders.map(order => ({
      order: order.order_number?.trim() || `Order ${order.order_id}`,
      customer: order.customer_name?.trim() || 'Unknown customer',
      created: order.created_date ? formatDateForAnswer(order.created_date) : 'Unknown date',
      status: order.status_name?.trim() || 'Not set',
    })),
    rowActions: summary.orders.map(buildOrderQuickActions),
    footer:
      summary.order_count > summary.orders.length
        ? 'Use Open, Client docs, or Quote to inspect the latest matching orders. Only the most recent matches are shown here.'
        : 'Use Open, Client docs, or Quote to inspect the matching orders.',
  };
}

export function buildOrdersLast7DaysCard(summary: AssistantOrdersLast7DaysSummary): AssistantCard {
  return {
    type: 'chart',
    title: summary.customer_name
      ? `Orders last 7 days for ${summary.customer_name}`
      : 'Orders last 7 days',
    description: `${formatDateForAnswer(summary.range_start)} to ${formatDateForAnswer(summary.range_end)}.`,
    metrics: [
      {
        label: 'Orders',
        value: formatNumber(summary.total_order_count),
      },
      {
        label: 'Avg / day',
        value: formatNumber(summary.average_per_day),
      },
      {
        label: 'Busiest day',
        value: summary.busiest_day
          ? `${formatDayLabel(summary.busiest_day.date)} (${formatNumber(summary.busiest_day.count)})`
          : '—',
      },
    ],
    points: summary.daily_counts.map(point => ({
      label: point.label,
      value: point.count,
    })),
    details: summary.recent_orders.map(order => ({
      label: order.order_number?.trim() || `Order ${order.order_id}`,
      value: order.created_date
        ? `${formatDateForAnswer(order.created_date)} | ${order.customer_name?.trim() || 'Unknown customer'}`
        : order.customer_name?.trim() || 'Unknown customer',
    })),
    actions: summary.recent_orders.map(order => ({
      label: `Preview ${order.order_number?.trim() || `Order ${order.order_id}`}`,
      kind: 'preview_order',
      orderId: order.order_id,
    })),
    footer:
      summary.total_order_count > 0
        ? 'Daily counts are based on order creation timestamps. Click a recent order to preview it.'
        : 'No orders were created in this period.',
  };
}

export function buildDueThisWeekCard(summary: AssistantDueThisWeekSummary): AssistantCard {
  return {
    type: 'table',
    title: summary.customer_name ? `Orders due this week for ${summary.customer_name}` : 'Orders due this week',
    description: `${formatDateForAnswer(summary.week_start)} to ${formatDateForAnswer(summary.week_end)}.`,
    metrics: [
      {
        label: 'Due this week',
        value: formatNumber(summary.due_order_count),
      },
      {
        label: 'Shown',
        value: formatNumber(summary.orders.length),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'customer', label: 'Customer' },
      { key: 'due_date', label: 'Due date' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.orders.map(order => ({
      order: order.order_number?.trim() || `Order ${order.order_id}`,
      customer: order.customer_name?.trim() || 'Unknown customer',
      due_date: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
      status: order.status_name?.trim() || 'Not set',
    })),
    rowActions: summary.orders.map(buildOrderQuickActions),
    footer:
      summary.due_order_count > summary.orders.length
        ? 'Use Open, Client docs, or Quote to inspect the nearest due orders.'
        : 'Use Open, Client docs, or Quote to inspect the orders due this week.',
  };
}

export function buildLateOrdersAnswer(summary: AssistantLateOrdersSummary) {
  const lines = [
    summary.customer_name
      ? `Late customer orders for ${summary.customer_name}: ${formatNumber(summary.late_order_count)}`
      : `Late customer orders: ${formatNumber(summary.late_order_count)}`,
  ];

  if (summary.late_orders.length > 0) {
    lines.push('');
    lines.push('Most overdue orders:');
    for (const order of summary.late_orders.slice(0, 5)) {
      const label = buildOrderLabel(order);
      lines.push(`- ${label} (${formatNumber(order.days_late)} days late)`);
    }
  } else {
    lines.push('No open customer orders are currently overdue.');
  }

  return lines.join('\n');
}

export function buildLateOrdersCard(summary: AssistantLateOrdersSummary): AssistantCard {
  return {
    type: 'table',
    title: summary.customer_name ? `Late orders for ${summary.customer_name}` : 'Late customer orders',
    description: 'Most overdue open customer orders, ranked by days late.',
    metrics: [
      {
        label: 'Late orders',
        value: formatNumber(summary.late_order_count),
      },
      {
        label: 'Shown',
        value: formatNumber(summary.late_orders.length),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'customer', label: 'Customer' },
      { key: 'due_date', label: 'Due date' },
      { key: 'days_late', label: 'Days late', align: 'right' },
    ],
    rows: summary.late_orders.map(order => ({
      order: order.order_number?.trim() || `Order ${order.order_id}`,
      customer: order.customer_name?.trim() || 'Unknown customer',
      due_date: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
      days_late: formatNumber(order.days_late),
    })),
    rowActions: summary.late_orders.map(buildOrderQuickActions),
    footer:
      summary.late_order_count > summary.late_orders.length
        ? 'Use Open, Client docs, or Quote to inspect the most overdue orders.'
        : 'Use Open, Client docs, or Quote to inspect the overdue orders.',
  };
}

export function buildLowStockAnswer(summary: AssistantLowStockSummary) {
  const lines = [`Items below reorder level: ${formatNumber(summary.low_stock_count)}`];

  if (summary.items.length > 0) {
    lines.push('');
    lines.push('Most urgent low-stock items:');
    for (const item of summary.items.slice(0, 5)) {
      const label = item.description ? `${item.internal_code} - ${item.description}` : item.internal_code;
      lines.push(
        `- ${label}: on hand ${formatNumber(item.quantity_on_hand)}, reorder ${formatNumber(item.reorder_level)}`
      );
    }
  } else {
    lines.push('Nothing is currently below reorder level.');
  }

  return lines.join('\n');
}

export function buildLowStockCard(summary: AssistantLowStockSummary): AssistantCard {
  return {
    type: 'table',
    title: 'Items below reorder level',
    description: 'Lowest on-hand items that are at or below their configured reorder level.',
    metrics: [
      {
        label: 'Low stock',
        value: formatNumber(summary.low_stock_count),
      },
      {
        label: 'Shown',
        value: formatNumber(summary.items.length),
      },
    ],
    columns: [
      {
        key: 'component',
        label: 'Component',
      },
      {
        key: 'on_hand',
        label: 'On hand',
        align: 'right',
      },
      {
        key: 'reorder_level',
        label: 'Reorder',
        align: 'right',
      },
      {
        key: 'shortage',
        label: 'Shortage',
        align: 'right',
      },
    ],
    rows: summary.items.map(item => ({
      component: item.description ? `${item.internal_code} - ${item.description}` : item.internal_code,
      on_hand: formatNumber(item.quantity_on_hand),
      reorder_level: formatNumber(item.reorder_level),
      shortage: formatNumber(item.shortage_qty),
    })),
    footer:
      summary.low_stock_count > summary.items.length
        ? 'Only the most urgent low-stock items are shown here.'
        : 'All current low-stock items are shown here.',
  };
}

export function extractOrderReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const orderNumberMatch = normalized.match(/\b([A-Z]{2,}[A-Z0-9-]*\d+[A-Z0-9-]*)\b/i);
  if (orderNumberMatch?.[1]) {
    return orderNumberMatch[1];
  }

  const orderIdMatch = normalized.match(/\border(?:\s*#)?\s*(\d+)\b/i);
  if (orderIdMatch?.[1]) {
    return orderIdMatch[1];
  }

  return null;
}

export function buildOrderBlockerAnswer(summary: AssistantOrderBlockerSummary) {
  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find an order matching "${summary.order_ref}" in Unity.`;
  }

  if (summary.kind === 'ambiguous') {
    return `I found multiple possible orders for "${summary.order_ref}". Please pick one of the suggested order numbers.`;
  }

  const orderLabel = summary.order.order_number?.trim() || `Order ${summary.order.order_id}`;
  if (summary.blocked_components === 0 && summary.waiting_on_deliveries_components === 0) {
    return `Here is the current supply status for ${orderLabel}. Nothing is currently blocking this order from a component stock perspective.`;
  }

  return `Here is the current supply status for ${orderLabel}.`;
}

export function buildOrderBlockerCard(
  summary: Extract<AssistantOrderBlockerSummary, { kind: 'summary' }>
): AssistantCard {
  const orderLabel = summary.order.order_number?.trim() || `Order ${summary.order.order_id}`;
  const rows = [
    ...summary.blocked_items.map(item => ({
      component: item.description ? `${item.internal_code} - ${item.description}` : item.internal_code,
      required: formatNumber(item.required),
      in_stock: formatNumber(item.in_stock),
      on_order: formatNumber(item.on_order),
      gap: formatNumber(item.shortfall),
      status: 'Blocked now',
    })),
    ...summary.waiting_items.map(item => ({
      component: item.description ? `${item.internal_code} - ${item.description}` : item.internal_code,
      required: formatNumber(item.required),
      in_stock: formatNumber(item.in_stock),
      on_order: formatNumber(item.on_order),
      gap: formatNumber(item.apparent_shortfall),
      status: 'Waiting on delivery',
    })),
  ];

  return {
    type: 'table',
    title: `Supply status for ${orderLabel}`,
    description: 'Verified component coverage for this order, including shortages covered by incoming supplier deliveries.',
    metrics: [
      {
        label: 'Blocked',
        value: formatNumber(summary.blocked_components),
      },
      {
        label: 'On supplier orders',
        value: formatNumber(summary.waiting_on_deliveries_components),
      },
      {
        label: 'Ready now',
        value: formatNumber(summary.ready_components),
      },
    ],
    columns: [
      { key: 'component', label: 'Component' },
      { key: 'required', label: 'Required', align: 'right' },
      { key: 'in_stock', label: 'In stock', align: 'right' },
      { key: 'on_order', label: 'On order', align: 'right' },
      { key: 'gap', label: 'Gap', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows,
    actions: [
      {
        label: 'Preview order',
        kind: 'preview_order',
        orderId: summary.order.order_id,
      },
      {
        label: 'Open order',
        kind: 'navigate',
        href: `/orders/${summary.order.order_id}`,
      },
      {
        label: 'Procurement',
        kind: 'navigate',
        href: `/orders/${summary.order.order_id}?tab=procurement`,
      },
      {
        label: 'Job cards',
        kind: 'ask',
        prompt: `What job cards are on order ${orderLabel}?`,
      },
    ],
    footer:
      rows.length > 0
        ? 'Blocked now means current stock is short. Waiting on delivery means incoming supplier orders should cover the gap.'
        : 'Nothing is currently blocking this order from a component stock perspective.',
  };
}
