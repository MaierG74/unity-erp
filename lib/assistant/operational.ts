import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantCard } from '@/lib/assistant/prompt-suggestions';

type OrderRelation = {
  status_name?: string | null;
};

type CustomerRelation = {
  name?: string | null;
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

export type AssistantOperationalIntent =
  | 'open_orders'
  | 'last_customer_order'
  | 'orders_last_7_days'
  | 'orders_due_this_week'
  | 'late_orders'
  | 'low_stock'
  | 'order_blockers';

const ORDER_QUERY_LIMIT = 60;
const CUSTOMER_QUERY_LIMIT = 12;

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
  next_due_orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    delivery_date: string | null;
    status_name: string | null;
  }>;
  listed_orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    delivery_date: string | null;
    status_name: string | null;
  }>;
};

export type AssistantDueThisWeekSummary = {
  customer_name: string | null;
  week_start: string;
  week_end: string;
  due_order_count: number;
  orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    delivery_date: string | null;
    status_name: string | null;
  }>;
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
  recent_orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    created_date: string | null;
  }>;
};

export type AssistantLastCustomerOrderSummary = {
  customer_name: string;
  latest_order: {
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    created_date: string | null;
    delivery_date: string | null;
    status_name: string | null;
  } | null;
  recent_orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    created_date: string | null;
    delivery_date: string | null;
    status_name: string | null;
  }>;
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
  late_orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    delivery_date: string | null;
    status_name: string | null;
    days_late: number;
  }>;
};

export type AssistantOrderBlockerSummary =
  | { kind: 'summary'; order: {
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

async function loadOpenOrders(
  supabase: SupabaseClient,
  options?: { customerName?: string | null; customerIds?: number[] | null }
) {
  let query = supabase
    .from('orders')
    .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)')
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
    .map(row => {
      const status = getRelationRecord(row.status);
      const customer = getRelationRecord(row.customer);
      const statusName = status?.status_name?.trim() || null;
      return {
        order_id: row.order_id,
        customer_id: row.customer_id ?? null,
        order_number: row.order_number?.trim() || null,
        created_at: row.created_at ?? null,
        delivery_date: row.delivery_date?.slice(0, 10) || null,
        customer_name: customer?.name?.trim() || null,
        status_name: statusName,
      };
    })
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
  return rows.map(row => {
    const status = getRelationRecord(row.status);
    const customer = getRelationRecord(row.customer);
    return {
      order_id: row.order_id,
      customer_id: row.customer_id ?? null,
      order_number: row.order_number?.trim() || null,
      created_at: row.created_at ?? null,
      delivery_date: row.delivery_date?.slice(0, 10) || null,
      customer_name: customer?.name?.trim() || null,
      status_name: status?.status_name?.trim() || null,
    };
  });
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
      .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)')
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
    .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)')
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
      .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)')
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
      .select('order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)')
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
    const statusLabel = order.status_name || 'No status set';
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

  const nextDueOrders = filteredOrders
    .filter(order => order.delivery_date != null && order.delivery_date >= today)
    .slice(0, 5);

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
    listed_orders: filteredOrders.slice(0, 8),
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

  return {
    customer_name: customerName?.trim() || null,
    week_start,
    week_end,
    due_order_count: dueOrders.length,
    orders: dueOrders.slice(0, 8),
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
    .select('order_id, customer_id, order_number, created_at, customer:customers(name)')
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

  const recentOrders = ((data ?? []) as OrderRow[]).map(row => {
    const customer = getRelationRecord(row.customer);
    const createdAt = row.created_at?.trim() || null;

    return {
      order_id: row.order_id,
      order_number: row.order_number?.trim() || null,
      customer_name: customer?.name?.trim() || null,
      created_date: createdAt ? getDateInZoneFromTimestamp(createdAt) : null,
    };
  });

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
      'order_id, customer_id, order_number, created_at, delivery_date, status:order_statuses(status_name), customer:customers(name)'
    )
    .in('customer_id', customerIds)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    throw error;
  }

  const recentOrders = ((data ?? []) as OrderRow[]).map(row => {
    const customer = getRelationRecord(row.customer);
    const status = getRelationRecord(row.status);
    const createdAt = row.created_at?.trim() || null;

    return {
      order_id: row.order_id,
      order_number: row.order_number?.trim() || null,
      customer_name: customer?.name?.trim() || null,
      created_date: createdAt ? getDateInZoneFromTimestamp(createdAt) : null,
      delivery_date: row.delivery_date?.slice(0, 10) || null,
      status_name: status?.status_name?.trim() || null,
    };
  });

  return {
    customer_name: customerName.trim(),
    latest_order: recentOrders[0] ?? null,
    recent_orders: recentOrders,
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

  return {
    customer_name: customerName?.trim() || null,
    late_order_count: filteredOrders.filter(order => order.delivery_date != null && order.delivery_date < today)
      .length,
    late_orders: lateOrders,
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
    /\b(blocking order|what is blocking order|what's blocking order|blocked order|order blocker)\b/.test(normalized)
  ) {
    return 'order_blockers';
  }

  if (
    /\b(open customer orders|open orders|customer orders)\b/.test(normalized) &&
    /\b(how many|count|what(?:'s| is)|show|list)\b/.test(normalized)
  ) {
    return 'open_orders';
  }

  return null;
}

export function extractOpenOrdersCustomerReference(message: string) {
  const normalized = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const patterns = [
    /\b(?:how many\s+)?(?:late orders|overdue orders)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:which orders are due this week|orders due this week)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:open customer orders|open orders|customer orders)\s+(?:for|from)\s+(.+)$/i,
    /\bhow many\s+(?:open customer orders|open orders|customer orders)\s+(?:for|from)\s+(.+)$/i,
    /\b(?:for|from)\s+(.+?)\s+(?:which orders are due this week|orders due this week)\b/i,
    /\b(?:for|from)\s+(.+?)\s+(?:late orders|overdue orders)\b/i,
    /\b(?:for|from)\s+(.+?)\s+(?:how many\s+)?(?:open customer orders|open orders|customer orders)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate
        .replace(/^(customer\s+)/i, '')
        .replace(/\b(?:are there|do we have|right now|currently)$/i, '')
        .trim();
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
    /\b(?:for|from)\s+(.+?)\s+(?:orders|customer orders)\s+(?:from|in)\s+(?:the\s+)?(?:last 7 days|past 7 days|last week)\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate.replace(/^(customer\s+)/i, '').trim();
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
    /\bwhat\s+was\s+the\s+(?:last|latest|most recent)\s+(?:customer\s+)?order\s+(?:for|from)\s+(.+)$/i,
    /\b(?:for|from)\s+(.+?)\s+(?:what\s+was\s+the\s+)?(?:last|latest|most recent)\s+(?:customer\s+)?order\b/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate.replace(/^(customer\s+)/i, '').trim();
    }
  }

  return null;
}

export function shouldListOpenOrders(message: string) {
  const normalized = message.toLowerCase().replace(/[?]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!/\b(open customer orders|open orders|customer orders)\b/.test(normalized)) {
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
  const lines = [
    summary.customer_name
      ? `Open customer orders for ${summary.customer_name}: ${formatNumber(summary.open_order_count)}`
      : `Open customer orders: ${formatNumber(summary.open_order_count)}`,
    `Due this week: ${formatNumber(summary.due_this_week_count)}`,
    `Overdue: ${formatNumber(summary.overdue_order_count)}`,
  ];

  if (summary.status_breakdown.length > 0) {
    lines.push(
      `Status breakdown: ${summary.status_breakdown
        .slice(0, 3)
        .map(item => `${item.status_name} (${formatNumber(item.count)})`)
        .join(', ')}`
    );
  }

  if (summary.next_due_orders.length > 0) {
    lines.push('');
    lines.push('Next due orders:');
    for (const order of summary.next_due_orders.slice(0, 3)) {
      lines.push(`- ${buildOrderLabel(order)}`);
    }
  }

  if (summary.missing_status_count > 0) {
    lines.push('');
    lines.push(
      `Note: ${formatNumber(summary.missing_status_count)} open orders currently have no explicit status set, so they are being treated as open.`
    );
  }

  if (options?.detailed) {
    if (summary.listed_orders.length > 0) {
      lines.push('');
      lines.push(summary.customer_name ? 'Open orders:' : 'Sample open orders:');
      for (const order of summary.listed_orders.slice(0, 8)) {
        lines.push(`- ${buildOrderLabel(order)}`);
      }
    } else {
      lines.push('');
      lines.push('No open customer orders matched that request.');
    }
  }

  return lines.join('\n');
}

export function buildOpenOrdersCard(
  summary: AssistantOpenOrdersSummary,
  options?: { detailed?: boolean }
): AssistantCard {
  const rows = (options?.detailed ? summary.listed_orders : summary.next_due_orders).map(order => ({
    order: order.order_number?.trim() || `Order ${order.order_id}`,
    customer: order.customer_name?.trim() || 'Unknown customer',
    due_date: order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date',
    status: order.status_name?.trim() || 'No status set',
  }));

  return {
    type: 'table',
    title: summary.customer_name ? `Open orders for ${summary.customer_name}` : 'Open customer orders',
    description: options?.detailed
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
    footer: options?.detailed
      ? summary.open_order_count > rows.length
        ? 'Only a sample of matching open orders is shown here.'
        : 'All matching open orders are shown here.'
      : summary.next_due_orders.length === 0
        ? 'No due-date sample is available for the current open orders.'
        : 'Showing the next due open orders.',
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
    `Status: ${latestOrder.status_name?.trim() || 'No status set'}`,
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
        value: summary.latest_order.status_name?.trim() || 'No status set',
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
      status: order.status_name?.trim() || 'No status set',
    })),
    actions: summary.recent_orders.map(order => ({
      label: `Open ${order.order_number?.trim() || `Order ${order.order_id}`}`,
      href: `/orders/${order.order_id}`,
    })),
    footer:
      summary.recent_orders.length > 0
        ? 'Click a row to open the order.'
        : undefined,
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
      label: `Open ${order.order_number?.trim() || `Order ${order.order_id}`}`,
      href: `/orders/${order.order_id}`,
    })),
    footer:
      summary.total_order_count > 0
        ? 'Daily counts are based on order creation timestamps.'
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
      status: order.status_name?.trim() || 'No status set',
    })),
    footer:
      summary.due_order_count > summary.orders.length
        ? 'Only the nearest due orders are shown here.'
        : 'All open customer orders due this week are shown here.',
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
    footer:
      summary.late_order_count > summary.late_orders.length
        ? 'Only the most overdue orders are shown here.'
        : 'All currently overdue orders are shown here.',
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
  const customerLabel = summary.order.customer_name?.trim() || 'Unknown customer';
  const lines = [
    `Order: ${orderLabel} (${customerLabel})`,
    `Blocked components: ${formatNumber(summary.blocked_components)}`,
    `Waiting on incoming deliveries: ${formatNumber(summary.waiting_on_deliveries_components)}`,
    `Ready now: ${formatNumber(summary.ready_components)}`,
  ];

  if (summary.blocked_items.length > 0) {
    lines.push('');
    lines.push('Blocking components:');
    for (const item of summary.blocked_items) {
      const label = item.description ? `${item.internal_code} - ${item.description}` : item.internal_code;
      lines.push(
        `- ${label}: need ${formatNumber(item.required)}, in stock ${formatNumber(item.in_stock)}, short ${formatNumber(item.shortfall)}`
      );
    }
  }

  if (summary.waiting_items.length > 0) {
    lines.push('');
    lines.push('Covered by incoming supplier orders:');
    for (const item of summary.waiting_items) {
      const label = item.description ? `${item.internal_code} - ${item.description}` : item.internal_code;
      lines.push(
        `- ${label}: need ${formatNumber(item.required)}, in stock ${formatNumber(item.in_stock)}, on order ${formatNumber(item.on_order)}`
      );
    }
  }

  if (summary.blocked_components === 0 && summary.waiting_on_deliveries_components === 0) {
    lines.push('');
    lines.push('Nothing is currently blocking this order from a component stock perspective.');
  }

  return lines.join('\n');
}
