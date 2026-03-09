import type { SupabaseClient } from '@supabase/supabase-js';

import { getRelationRecord } from '@/lib/assistant/component-resolver';
import { resolveOrderReference } from '@/lib/assistant/operational';
import type { AssistantCard } from '@/lib/assistant/prompt-suggestions';
import {
  resolveAssistantProduct,
  type AssistantProductLookupResult,
} from '@/lib/assistant/product-resolver';

type ProductRelation = {
  product_id: number;
  internal_code?: string | null;
  name?: string | null;
  description?: string | null;
};

type StaffRelation = {
  first_name?: string | null;
  last_name?: string | null;
};

type CustomerRelation = {
  name?: string | null;
};

type OrderRelation = {
  order_number?: string | null;
  customer?: CustomerRelation | CustomerRelation[] | null;
};

type JobCardRelation = {
  job_card_id: number;
  status?: string | null;
  issue_date?: string | null;
  completion_date?: string | null;
  staff?: StaffRelation | StaffRelation[] | null;
  order?: OrderRelation | OrderRelation[] | null;
};

type ManufacturingRow = {
  item_id: number;
  quantity?: number | string | null;
  completed_quantity?: number | string | null;
  status?: string | null;
  completion_time?: string | null;
  product?: ProductRelation | ProductRelation[] | null;
  job_card?: JobCardRelation | JobCardRelation[] | null;
};

type JobCardItemRelation = {
  item_id: number;
  quantity?: number | string | null;
  completed_quantity?: number | string | null;
  status?: string | null;
  completion_time?: string | null;
  product?: ProductRelation | ProductRelation[] | null;
};

type OrderManufacturingJobCardRow = {
  job_card_id: number;
  status?: string | null;
  issue_date?: string | null;
  completion_date?: string | null;
  staff?: StaffRelation | StaffRelation[] | null;
  items?: JobCardItemRelation[] | null;
  order?: OrderRelation | OrderRelation[] | null;
};

type AssistantOrderJobCardDetail = {
  job_card_id: number;
  status: string | null;
  issue_date: string | null;
  completion_date: string | null;
  staff_name: string | null;
  product_labels: string[];
  planned_quantity: number;
  completed_quantity: number;
};

export type AssistantManufacturingSummary =
  | {
      kind: 'summary';
      product: {
        product_id: number;
        internal_code: string | null;
        name: string | null;
        description: string | null;
      };
      total_completed_quantity: number;
      total_planned_quantity: number;
      completed_job_cards: number;
      active_job_cards: number;
      latest_completion_date: string | null;
      latest_completed_by: string | null;
      latest_order_number: string | null;
      latest_customer_name: string | null;
      recent_completions: Array<{
        job_card_id: number;
        completion_date: string | null;
        completed_by: string | null;
        order_number: string | null;
        customer_name: string | null;
        completed_quantity: number;
      }>;
    }
  | ({
      kind: 'ambiguous';
    } & Extract<AssistantProductLookupResult, { kind: 'ambiguous' }>)
  | ({
      kind: 'not_found';
    } & Extract<AssistantProductLookupResult, { kind: 'not_found' }>);

export type AssistantOrderManufacturingSummary =
  | {
      kind: 'summary';
      order: {
        order_id: number;
        order_number: string | null;
        customer_name: string | null;
        delivery_date: string | null;
        status_name: string | null;
      };
      total_job_cards: number;
      completed_job_cards: number;
      active_job_cards: number;
      total_completed_quantity: number;
      total_planned_quantity: number;
      latest_completion_date: string | null;
      latest_completed_by: string | null;
      related_products: string[];
      job_cards: AssistantOrderJobCardDetail[];
      recent_completions: Array<{
        job_card_id: number;
        completion_date: string | null;
        completed_by: string | null;
        completed_quantity: number;
        product_labels: string[];
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

export type AssistantManufacturingFocus =
  | 'status'
  | 'who'
  | 'when'
  | 'in_production'
  | 'progress';

export type AssistantManufacturingListIntent =
  | 'orders_in_production'
  | 'orders_completed_this_week'
  | 'production_staffing'
  | 'unassigned_production_work';

export type AssistantManufacturingOrderListSummary = {
  kind: AssistantManufacturingListIntent;
  week_start: string | null;
  week_end: string | null;
  order_count: number;
  orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    active_job_cards: number;
    completed_job_cards: number;
    latest_completion_date: string | null;
    latest_completed_by: string | null;
    related_products: string[];
  }>;
};

export type AssistantManufacturingStaffingSummary = {
  kind: 'production_staffing';
  order_count: number;
  staff_count: number;
  unassigned_job_cards: number;
  assignments: Array<{
    staff_name: string | null;
    active_job_cards: number;
    orders: Array<{
      order_id: number;
      order_number: string | null;
      customer_name: string | null;
      active_job_cards: number;
    }>;
  }>;
};

export type AssistantUnassignedProductionWorkSummary = {
  kind: 'unassigned_production_work';
  order_count: number;
  unassigned_job_cards: number;
  orders: Array<{
    order_id: number;
    order_number: string | null;
    customer_name: string | null;
    active_job_cards: number;
  }>;
};

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatDateTimeForAnswer(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Johannesburg',
  }).format(date);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function formatJobCardStatus(status: string | null | undefined) {
  switch (status?.trim().toLowerCase()) {
    case 'in_progress':
      return 'In progress';
    case 'pending':
      return 'Pending';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Not set';
  }
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

function formatStaffName(staff: StaffRelation | null) {
  const first = staff?.first_name?.trim() ?? '';
  const last = staff?.last_name?.trim() ?? '';
  const fullName = `${first} ${last}`.trim();
  return fullName || null;
}

function buildProductLabel(product: {
  internal_code: string | null;
  name: string | null;
}) {
  if (product.internal_code && product.name) {
    return `${product.internal_code} - ${product.name}`;
  }

  return product.name ?? product.internal_code ?? 'Unknown product';
}

function buildOrderLabel(order: {
  order_id: number;
  order_number: string | null;
  customer_name: string | null;
}) {
  const orderNumber = order.order_number?.trim() || `Order ${order.order_id}`;
  return order.customer_name?.trim() ? `${orderNumber} (${order.customer_name.trim()})` : orderNumber;
}

export function detectManufacturingIntent(message: string) {
  const normalized = message.toLowerCase();

  if (
    /\b(?:what|which|show|list)\s+job cards?\s+(?:are\s+)?(?:on|for|attached to)\s+(?:this\s+)?order\b/.test(
      normalized
    ) ||
    /\b(?:what|which|show|list)\s+job cards?\s+(?:are\s+)?(?:on|for|attached to)\s+order\s+.+\b/.test(
      normalized
    )
  ) {
    return 'order_job_cards' as const;
  }

  if (
    /\b(who|which staff|what staff)\s+(?:is|are)\s+(?:working|assigned|busy)\s+(?:on\s+)?orders?\s+(?:that\s+are\s+)?(?:still\s+)?in\s+production\b/.test(
      normalized
    ) ||
    /\bwho\s+(?:is|are)\s+working\s+in\s+production\b/.test(normalized) ||
    /\bwho\s+(?:is|are)\s+(?:making|building)\s+orders\b/.test(normalized)
  ) {
    return 'production_staffing' as const;
  }

  if (
    /\b(which orders|what orders|show|list)\s+(?:have|with)\s+unassigned\s+(?:work|job cards?)\b/.test(
      normalized
    ) ||
    /\b(unassigned\s+(?:production\s+)?work|unassigned\s+job cards?\s+in\s+production)\b/.test(
      normalized
    )
  ) {
    return 'unassigned_production_work' as const;
  }

  if (/\b(which|show|list)\s+orders\s+(are\s+)?(still\s+)?in\s+production\b/.test(normalized)) {
    return 'orders_in_production' as const;
  }

  if (/\b(which|show|list)\s+orders\s+(finished|completed)\s+(this|last)\s+week\b/.test(normalized)) {
    return 'orders_completed_this_week' as const;
  }

  if (
    /\b(manufactured|already made|already manufactured|in production|completed product|completed manufacturing)\b/.test(
      normalized
    )
  ) {
    return 'manufacturing_status' as const;
  }

  if (
    /\b(production progress|how far along|progress on|progress for)\b/.test(normalized) ||
    /\b(job cards?\s+(?:are\s+)?(?:owing|remaining|outstanding)|what job cards?\s+(?:are\s+)?(?:owing|remaining|outstanding))\b/.test(
      normalized
    )
  ) {
    return 'manufacturing_status' as const;
  }

  if (/\b(who made|who manufactured|who completed)\b/.test(normalized)) {
    return 'manufacturing_status' as const;
  }

  if (/\b(when was .* completed|when was .* manufactured|completion date)\b/.test(normalized)) {
    return 'manufacturing_status' as const;
  }

  return null;
}

export function detectManufacturingFocus(message: string): AssistantManufacturingFocus | null {
  const normalized = message.toLowerCase();

  if (/\b(who made|who manufactured|who completed|who built)\b/.test(normalized)) {
    return 'who';
  }

  if (
    /\b(when was .* completed|when was .* manufactured|when was .* finished|completion date|completed on)\b/.test(
      normalized
    )
  ) {
    return 'when';
  }

  if (/\b(in production|currently being made|still being made|still in production)\b/.test(normalized)) {
    return 'in_production';
  }

  if (
    /\b(production progress|how far along|progress on|progress for|completion progress)\b/.test(normalized) ||
    /\b(job cards?\s+(?:are\s+)?(?:owing|remaining|outstanding)|what job cards?\s+(?:are\s+)?(?:owing|remaining|outstanding))\b/.test(
      normalized
    )
  ) {
    return 'progress';
  }

  if (
    /\b(manufactured|already made|already manufactured|completed product|completed manufacturing|finished)\b/.test(
      normalized
    )
  ) {
    return 'status';
  }

  return null;
}

export function extractManufacturingProductReference(message: string) {
  const normalized = message.replace(/[?]/g, ' ').replace(/\s+/g, ' ').trim();

  const patterns = [
    /\bhas\s+(?:this\s+)?product\s+(.+?)\s+been\s+manufactured\b/i,
    /\bhas\s+(.+?)\s+been\s+manufactured\b/i,
    /\bwas\s+(.+?)\s+(?:already\s+)?made\b/i,
    /\bwho\s+(?:made|manufactured|completed)\s+(.+?)\b/i,
    /\bwhen\s+was\s+(.+?)\s+(?:completed|manufactured)\b/i,
    /\bis\s+(.+?)\s+in\s+production\b/i,
    /\b(?:show|what(?:'s| is))\s+(?:the\s+)?production progress\s+(?:for\s+)?(.+?)\b/i,
    /\bhow\s+far\s+along\s+is\s+(.+?)\b/i,
  ];

  for (const pattern of patterns) {
    const candidate = normalized.match(pattern)?.[1]?.trim();
    if (candidate) {
      return candidate
        .replace(/^(?:product\s+)/i, '')
        .replace(/\s+(?:product)$/i, '')
        .trim();
    }
  }

  return null;
}

export function extractManufacturingOrderReference(message: string) {
  const normalized = message.replace(/[?]/g, ' ').replace(/\s+/g, ' ').trim();
  const patterns = [
    /\bhas\s+order\s+(.+?)\s+been\s+manufactured\b/i,
    /\bwho\s+(?:made|manufactured|completed)\s+order\s+(.+?)\b/i,
    /\bwhen\s+was\s+order\s+(.+?)\s+(?:completed|manufactured|finished)\b/i,
    /\bis\s+order\s+(.+?)\s+in\s+production\b/i,
    /\b(?:show|what(?:'s| is))\s+(?:the\s+)?production progress\s+(?:for\s+)?order\s+(.+?)\b/i,
    /\bhow\s+far\s+along\s+is\s+order\s+(.+?)\b/i,
    /\b(?:what|which|show|list)\s+job cards?\s+(?:are\s+)?(?:on|for|attached to)\s+order\s+(.+?)\b/i,
  ];

  for (const pattern of patterns) {
    const candidate = normalized.match(pattern)?.[1]?.trim();
    if (candidate) {
      return candidate
        .replace(/^(?:order\s+(?:number\s+)?)?/i, '')
        .trim();
    }
  }

  return null;
}

export async function getManufacturingSummary(
  supabase: SupabaseClient,
  productRef: string
): Promise<AssistantManufacturingSummary> {
  const resolved = await resolveAssistantProduct(supabase, productRef);
  if (resolved.kind === 'ambiguous') {
    return { kind: 'ambiguous', ...resolved };
  }

  if (resolved.kind === 'not_found') {
    return { kind: 'not_found', ...resolved };
  }

  const { data, error } = await supabase
    .from('job_card_items')
    .select(`
      item_id,
      quantity,
      completed_quantity,
      status,
      completion_time,
      product:products!inner(product_id, internal_code, name, description),
      job_card:job_cards!inner(
        job_card_id,
        status,
        issue_date,
        completion_date,
        staff:staff_id(first_name, last_name),
        order:order_id(order_number, customer:customers(name))
      )
    `)
    .eq('product_id', resolved.product.product_id);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as ManufacturingRow[]).map(row => {
    const product = getRelationRecord(row.product);
    const jobCard = getRelationRecord(row.job_card);
    const staff = getRelationRecord(jobCard?.staff);
    const order = getRelationRecord(jobCard?.order);
    const customer = getRelationRecord(order?.customer);
    return {
      item_id: row.item_id,
      quantity: toNumber(row.quantity),
      completed_quantity: toNumber(row.completed_quantity),
      item_status: row.status?.trim().toLowerCase() ?? null,
      completion_time: row.completion_time ?? null,
      product: {
        product_id: product?.product_id ?? resolved.product.product_id,
        internal_code: product?.internal_code?.trim() ?? resolved.product.internal_code ?? null,
        name: product?.name?.trim() ?? resolved.product.name ?? null,
        description: product?.description?.trim() ?? resolved.product.description ?? null,
      },
      job_card: jobCard
        ? {
            job_card_id: jobCard.job_card_id,
            status: jobCard.status?.trim().toLowerCase() ?? null,
            issue_date: jobCard.issue_date ?? null,
            completion_date: jobCard.completion_date ?? null,
            completed_by: formatStaffName(staff),
            order_number: order?.order_number?.trim() ?? null,
            customer_name: customer?.name?.trim() ?? null,
          }
        : null,
    };
  });

  const totalPlannedQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const totalCompletedQuantity = rows.reduce((sum, row) => sum + row.completed_quantity, 0);
  const uniqueCards = new Map<number, typeof rows[number]['job_card']>();

  for (const row of rows) {
    if (row.job_card) {
      uniqueCards.set(row.job_card.job_card_id, row.job_card);
    }
  }

  const completedJobCards = Array.from(uniqueCards.values()).filter(
    card => card?.status === 'completed' || Boolean(card?.completion_date)
  );
  const activeJobCards = Array.from(uniqueCards.values()).filter(
    card => card?.status === 'pending' || card?.status === 'in_progress'
  );

  const recentCompletions = rows
    .filter(row => row.completed_quantity > 0 || Boolean(row.job_card?.completion_date))
    .sort((a, b) => {
      const aDate = a.job_card?.completion_date ?? a.completion_time ?? '';
      const bDate = b.job_card?.completion_date ?? b.completion_time ?? '';
      return bDate.localeCompare(aDate);
    })
    .slice(0, 5)
    .map(row => ({
      job_card_id: row.job_card?.job_card_id ?? row.item_id,
      completion_date: row.job_card?.completion_date ?? row.completion_time ?? null,
      completed_by: row.job_card?.completed_by ?? null,
      order_number: row.job_card?.order_number ?? null,
      customer_name: row.job_card?.customer_name ?? null,
      completed_quantity: row.completed_quantity,
    }));

  const latestCompletion = recentCompletions[0] ?? null;

  return {
    kind: 'summary',
    product: resolved.product,
    total_completed_quantity: totalCompletedQuantity,
    total_planned_quantity: totalPlannedQuantity,
    completed_job_cards: completedJobCards.length,
    active_job_cards: activeJobCards.length,
    latest_completion_date: latestCompletion?.completion_date ?? null,
    latest_completed_by: latestCompletion?.completed_by ?? null,
    latest_order_number: latestCompletion?.order_number ?? null,
    latest_customer_name: latestCompletion?.customer_name ?? null,
    recent_completions: recentCompletions,
  };
}

export async function getOrderManufacturingSummary(
  supabase: SupabaseClient,
  orderRef: string
): Promise<AssistantOrderManufacturingSummary> {
  const resolved = await resolveOrderReference(supabase, orderRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const { data, error } = await supabase
    .from('job_cards')
    .select(`
      job_card_id,
      status,
      issue_date,
      completion_date,
      staff:staff_id(first_name, last_name),
      items:job_card_items(
        item_id,
        quantity,
        completed_quantity,
        status,
        completion_time,
        product:product_id(product_id, internal_code, name, description)
      )
    `)
    .eq('order_id', resolved.order.order_id)
    .order('job_card_id', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as OrderManufacturingJobCardRow[];
  if (rows.length === 0) {
    return {
      kind: 'summary',
      order: resolved.order,
      total_job_cards: 0,
      completed_job_cards: 0,
      active_job_cards: 0,
      total_completed_quantity: 0,
    total_planned_quantity: 0,
    latest_completion_date: null,
    latest_completed_by: null,
    related_products: [],
    job_cards: [],
    recent_completions: [],
  };
  }

  const normalizedRows = rows.map(row => {
    const staff = getRelationRecord(row.staff);
    const items = (row.items ?? []).map(item => {
      const product = getRelationRecord(item.product);
      return {
        item_id: item.item_id,
        quantity: toNumber(item.quantity),
        completed_quantity: toNumber(item.completed_quantity),
        completion_time: item.completion_time ?? null,
        product_label: buildProductLabel({
          internal_code: product?.internal_code?.trim() ?? null,
          name: product?.name?.trim() ?? null,
        }),
      };
    });

    return {
      job_card_id: row.job_card_id,
      status: row.status?.trim().toLowerCase() ?? null,
      issue_date: row.issue_date ?? null,
      completion_date: row.completion_date ?? null,
      completed_by: formatStaffName(staff),
      items,
    };
  });

  const totalJobCards = normalizedRows.length;
  const completedJobCards = normalizedRows.filter(
    row => row.status === 'completed' || Boolean(row.completion_date)
  );
  const activeJobCards = normalizedRows.filter(
    row => row.status === 'pending' || row.status === 'in_progress'
  );
  const totalPlannedQuantity = normalizedRows.reduce(
    (sum, row) => sum + row.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
    0
  );
  const totalCompletedQuantity = normalizedRows.reduce(
    (sum, row) => sum + row.items.reduce((itemSum, item) => itemSum + item.completed_quantity, 0),
    0
  );

  const relatedProducts = Array.from(
    new Set(
      normalizedRows.flatMap(row => row.items.map(item => item.product_label).filter(label => label !== 'Unknown product'))
    )
  ).slice(0, 5);

  const recentCompletions = normalizedRows
    .filter(
      row =>
        Boolean(row.completion_date) || row.items.some(item => item.completed_quantity > 0 || Boolean(item.completion_time))
    )
    .sort((a, b) => {
      const aDate = a.completion_date ?? a.items[0]?.completion_time ?? '';
      const bDate = b.completion_date ?? b.items[0]?.completion_time ?? '';
      return bDate.localeCompare(aDate);
    })
    .slice(0, 5)
    .map(row => ({
      job_card_id: row.job_card_id,
      completion_date: row.completion_date ?? row.items[0]?.completion_time ?? null,
      completed_by: row.completed_by,
      completed_quantity: row.items.reduce((sum, item) => sum + item.completed_quantity, 0),
      product_labels: Array.from(new Set(row.items.map(item => item.product_label))).slice(0, 3),
    }));

  const jobCards = normalizedRows
    .slice()
    .sort((a, b) => {
      const aDate = a.issue_date ?? a.completion_date ?? '';
      const bDate = b.issue_date ?? b.completion_date ?? '';
      return bDate.localeCompare(aDate);
    })
    .map(row => ({
      job_card_id: row.job_card_id,
      status: row.status,
      issue_date: row.issue_date,
      completion_date: row.completion_date,
      staff_name: row.completed_by,
      product_labels: Array.from(new Set(row.items.map(item => item.product_label))).filter(
        label => label !== 'Unknown product'
      ),
      planned_quantity: row.items.reduce((sum, item) => sum + item.quantity, 0),
      completed_quantity: row.items.reduce((sum, item) => sum + item.completed_quantity, 0),
    }));

  const latestCompletion = recentCompletions[0] ?? null;

  return {
    kind: 'summary',
    order: resolved.order,
    total_job_cards: totalJobCards,
    completed_job_cards: completedJobCards.length,
    active_job_cards: activeJobCards.length,
    total_completed_quantity: totalCompletedQuantity,
    total_planned_quantity: totalPlannedQuantity,
    latest_completion_date: latestCompletion?.completion_date ?? null,
    latest_completed_by: latestCompletion?.completed_by ?? null,
    related_products: relatedProducts,
    job_cards: jobCards,
    recent_completions: recentCompletions,
  };
}

export async function getOrdersInProductionSummary(
  supabase: SupabaseClient
): Promise<AssistantManufacturingOrderListSummary> {
  const { data, error } = await supabase
    .from('job_cards')
    .select(`
      job_card_id,
      status,
      completion_date,
      staff:staff_id(first_name, last_name),
      order:order_id(order_id, order_number, customer:customers(name)),
      items:job_card_items(
        item_id,
        product:product_id(product_id, internal_code, name, description)
      )
    `)
    .in('status', ['pending', 'in_progress'])
    .order('job_card_id', { ascending: false });

  if (error) {
    throw error;
  }

  const grouped = new Map<
    number,
    {
      order_id: number;
      order_number: string | null;
      customer_name: string | null;
      active_job_cards: number;
      completed_job_cards: number;
      latest_completion_date: string | null;
      latest_completed_by: string | null;
      related_products: Set<string>;
    }
  >();

  for (const row of (data ?? []) as OrderManufacturingJobCardRow[]) {
    const order = getRelationRecord(row.order);
    if (!order?.order_id) {
      continue;
    }

    const existing = grouped.get(order.order_id) ?? {
      order_id: order.order_id,
      order_number: order.order_number?.trim() ?? null,
      customer_name: getRelationRecord(order.customer)?.name?.trim() ?? null,
      active_job_cards: 0,
      completed_job_cards: 0,
      latest_completion_date: null,
      latest_completed_by: null,
      related_products: new Set<string>(),
    };

    existing.active_job_cards += 1;

    for (const item of row.items ?? []) {
      const product = getRelationRecord(item.product);
      const label = buildProductLabel({
        internal_code: product?.internal_code?.trim() ?? null,
        name: product?.name?.trim() ?? null,
      });
      if (label !== 'Unknown product') {
        existing.related_products.add(label);
      }
    }

    grouped.set(order.order_id, existing);
  }

  const orders = Array.from(grouped.values())
    .sort((a, b) => {
      const aNumber = (a.order_number ?? '').toLowerCase();
      const bNumber = (b.order_number ?? '').toLowerCase();
      return aNumber.localeCompare(bNumber);
    })
    .slice(0, 12)
    .map(order => ({
      ...order,
      related_products: Array.from(order.related_products).slice(0, 3),
    }));

  return {
    kind: 'orders_in_production',
    week_start: null,
    week_end: null,
    order_count: grouped.size,
    orders,
  };
}

export async function getOrdersCompletedThisWeekSummary(
  supabase: SupabaseClient
): Promise<AssistantManufacturingOrderListSummary> {
  const today = getCurrentDateInZone();
  const { week_start, week_end } = getWeekRange(today);

  const { data, error } = await supabase
    .from('job_cards')
    .select(`
      job_card_id,
      status,
      completion_date,
      staff:staff_id(first_name, last_name),
      order:order_id(order_id, order_number, customer:customers(name)),
      items:job_card_items(
        item_id,
        product:product_id(product_id, internal_code, name, description)
      )
    `)
    .gte('completion_date', week_start)
    .lte('completion_date', week_end)
    .order('completion_date', { ascending: false });

  if (error) {
    throw error;
  }

  const grouped = new Map<
    number,
    {
      order_id: number;
      order_number: string | null;
      customer_name: string | null;
      active_job_cards: number;
      completed_job_cards: number;
      latest_completion_date: string | null;
      latest_completed_by: string | null;
      related_products: Set<string>;
    }
  >();

  for (const row of (data ?? []) as OrderManufacturingJobCardRow[]) {
    const order = getRelationRecord(row.order);
    if (!order?.order_id) {
      continue;
    }

    const existing = grouped.get(order.order_id) ?? {
      order_id: order.order_id,
      order_number: order.order_number?.trim() ?? null,
      customer_name: getRelationRecord(order.customer)?.name?.trim() ?? null,
      active_job_cards: 0,
      completed_job_cards: 0,
      latest_completion_date: null,
      latest_completed_by: null,
      related_products: new Set<string>(),
    };

    existing.completed_job_cards += 1;

    const completionDate = row.completion_date?.trim() ?? null;
    if (completionDate && (!existing.latest_completion_date || completionDate > existing.latest_completion_date)) {
      existing.latest_completion_date = completionDate;
      existing.latest_completed_by = formatStaffName(getRelationRecord(row.staff));
    }

    for (const item of row.items ?? []) {
      const product = getRelationRecord(item.product);
      const label = buildProductLabel({
        internal_code: product?.internal_code?.trim() ?? null,
        name: product?.name?.trim() ?? null,
      });
      if (label !== 'Unknown product') {
        existing.related_products.add(label);
      }
    }

    grouped.set(order.order_id, existing);
  }

  const orders = Array.from(grouped.values())
    .sort((a, b) => (b.latest_completion_date ?? '').localeCompare(a.latest_completion_date ?? ''))
    .slice(0, 12)
    .map(order => ({
      ...order,
      related_products: Array.from(order.related_products).slice(0, 3),
    }));

  return {
    kind: 'orders_completed_this_week',
    week_start,
    week_end,
    order_count: grouped.size,
    orders,
  };
}

export async function getProductionStaffingSummary(
  supabase: SupabaseClient
): Promise<AssistantManufacturingStaffingSummary> {
  const { data, error } = await supabase
    .from('job_cards')
    .select(`
      job_card_id,
      status,
      staff:staff_id(first_name, last_name),
      order:order_id(order_id, order_number, customer:customers(name))
    `)
    .in('status', ['pending', 'in_progress'])
    .order('job_card_id', { ascending: false });

  if (error) {
    throw error;
  }

  const assignments = new Map<
    string,
    {
      staff_name: string | null;
      active_job_cards: number;
      orders: Map<
        number,
        {
          order_id: number;
          order_number: string | null;
          customer_name: string | null;
          active_job_cards: number;
        }
      >;
    }
  >();
  const orderIds = new Set<number>();

  for (const row of (data ?? []) as OrderManufacturingJobCardRow[]) {
    const order = getRelationRecord(row.order);
    if (!order?.order_id) {
      continue;
    }

    orderIds.add(order.order_id);

    const staffName = formatStaffName(getRelationRecord(row.staff));
    const assignmentKey = staffName ?? '__unassigned__';
    const existing = assignments.get(assignmentKey) ?? {
      staff_name: staffName,
      active_job_cards: 0,
      orders: new Map<number, { order_id: number; order_number: string | null; customer_name: string | null; active_job_cards: number }>(),
    };

    existing.active_job_cards += 1;

    const orderEntry = existing.orders.get(order.order_id) ?? {
      order_id: order.order_id,
      order_number: order.order_number?.trim() ?? null,
      customer_name: getRelationRecord(order.customer)?.name?.trim() ?? null,
      active_job_cards: 0,
    };
    orderEntry.active_job_cards += 1;
    existing.orders.set(order.order_id, orderEntry);

    assignments.set(assignmentKey, existing);
  }

  const orderedAssignments = Array.from(assignments.values())
    .sort((a, b) => {
      if (a.staff_name == null && b.staff_name != null) return 1;
      if (a.staff_name != null && b.staff_name == null) return -1;
      if (b.active_job_cards !== a.active_job_cards) return b.active_job_cards - a.active_job_cards;
      return (a.staff_name ?? '').localeCompare(b.staff_name ?? '');
    })
    .slice(0, 12)
    .map(assignment => ({
      staff_name: assignment.staff_name,
      active_job_cards: assignment.active_job_cards,
      orders: Array.from(assignment.orders.values())
        .sort((a, b) => {
          if (b.active_job_cards !== a.active_job_cards) return b.active_job_cards - a.active_job_cards;
          return (a.order_number ?? '').localeCompare(b.order_number ?? '');
        })
        .slice(0, 4),
    }));

  return {
    kind: 'production_staffing',
    order_count: orderIds.size,
    staff_count: orderedAssignments.filter(assignment => assignment.staff_name != null).length,
    unassigned_job_cards: orderedAssignments.find(assignment => assignment.staff_name == null)?.active_job_cards ?? 0,
    assignments: orderedAssignments,
  };
}

export async function getUnassignedProductionWorkSummary(
  supabase: SupabaseClient
): Promise<AssistantUnassignedProductionWorkSummary> {
  const { data, error } = await supabase
    .from('job_cards')
    .select(`
      job_card_id,
      status,
      order:order_id(order_id, order_number, customer:customers(name))
    `)
    .in('status', ['pending', 'in_progress'])
    .is('staff_id', null)
    .order('job_card_id', { ascending: false });

  if (error) {
    throw error;
  }

  const grouped = new Map<
    number,
    {
      order_id: number;
      order_number: string | null;
      customer_name: string | null;
      active_job_cards: number;
    }
  >();

  for (const row of (data ?? []) as OrderManufacturingJobCardRow[]) {
    const order = getRelationRecord(row.order);
    if (!order?.order_id) {
      continue;
    }

    const existing = grouped.get(order.order_id) ?? {
      order_id: order.order_id,
      order_number: order.order_number?.trim() ?? null,
      customer_name: getRelationRecord(order.customer)?.name?.trim() ?? null,
      active_job_cards: 0,
    };

    existing.active_job_cards += 1;
    grouped.set(order.order_id, existing);
  }

  const orders = Array.from(grouped.values())
    .sort((a, b) => {
      if (b.active_job_cards !== a.active_job_cards) return b.active_job_cards - a.active_job_cards;
      return (a.order_number ?? '').localeCompare(b.order_number ?? '');
    })
    .slice(0, 12);

  return {
    kind: 'unassigned_production_work',
    order_count: grouped.size,
    unassigned_job_cards: orders.reduce((sum, order) => sum + order.active_job_cards, 0),
    orders,
  };
}

function appendRecentCompletions(
  lines: string[],
  summary: Extract<AssistantManufacturingSummary, { kind: 'summary' }>
) {
  if (summary.recent_completions.length === 0) {
    return;
  }

  lines.push('');
  lines.push('Recent manufacturing completions:');
  for (const item of summary.recent_completions.slice(0, 3)) {
    const when = item.completion_date ? formatDateTimeForAnswer(item.completion_date) : 'Unknown date';
    const who = item.completed_by ?? 'Unknown staff';
    const order = item.order_number ? ` — ${item.order_number}` : '';
    const customer = item.customer_name ? ` (${item.customer_name})` : '';
    lines.push(`- ${when} — ${who}${order}${customer} — qty ${formatNumber(item.completed_quantity)}`);
  }
}

function calculateProgressPercent(completed: number, planned: number, numeratorFallback: number, denominatorFallback: number) {
  if (planned > 0) {
    return Math.max(0, Math.min(100, (completed / planned) * 100));
  }

  if (denominatorFallback > 0) {
    return Math.max(0, Math.min(100, (numeratorFallback / denominatorFallback) * 100));
  }

  return 0;
}

export function buildManufacturingAnswer(
  summary: AssistantManufacturingSummary,
  options?: { focus?: AssistantManufacturingFocus | null }
) {
  if (summary.kind === 'ambiguous') {
    return `I found multiple possible products for "${summary.product_ref}". Which one did you mean?`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find a product matching "${summary.product_ref}".`;
  }

  const label = buildProductLabel(summary.product);
  const manufactured = summary.total_completed_quantity > 0 || summary.completed_job_cards > 0;
  const focus = options?.focus ?? 'status';
  const latestCompletion =
    summary.latest_completion_date ? formatDateTimeForAnswer(summary.latest_completion_date) : null;
  const latestCompletedOrder = summary.latest_order_number
    ? `${summary.latest_order_number}${summary.latest_customer_name ? ` (${summary.latest_customer_name})` : ''}`
    : null;
  const lines: string[] = [];

  if (focus === 'who') {
    if (summary.latest_completed_by) {
      lines.push(`The latest verified manufacturing completion for ${label} was done by ${summary.latest_completed_by}.`);
      if (latestCompletion) {
        lines.push(`Latest completion: ${latestCompletion}`);
      }
      if (latestCompletedOrder) {
        lines.push(`Latest completed order: ${latestCompletedOrder}`);
      }
    } else if (summary.active_job_cards > 0) {
      lines.push(
        `I can't verify who completed ${label} yet because it is still in production and there is no verified completed manufacturing record linked to this product.`
      );
    } else {
      lines.push(
        `I don't know who manufactured ${label} because I could not find a verified completed manufacturing record linked to this product.`
      );
    }
  } else if (focus === 'when') {
    if (latestCompletion) {
      lines.push(`The latest verified manufacturing completion for ${label} was on ${latestCompletion}.`);
      if (summary.latest_completed_by) {
        lines.push(`Latest completed by: ${summary.latest_completed_by}`);
      }
      if (latestCompletedOrder) {
        lines.push(`Latest completed order: ${latestCompletedOrder}`);
      }
    } else if (summary.active_job_cards > 0) {
      lines.push(
        `I can't verify when ${label} was completed because it is still in production and there is no verified completed manufacturing record yet.`
      );
    } else {
      lines.push(
        `I don't know when ${label} was completed because I could not find a verified completed manufacturing record linked to this product.`
      );
    }
  } else if (focus === 'in_production') {
    if (summary.active_job_cards > 0) {
      lines.push(`Yes, ${label} is currently in production.`);
      lines.push(`Open job cards: ${formatNumber(summary.active_job_cards)}`);
      lines.push(`Planned quantity on open linked job cards: ${formatNumber(summary.total_planned_quantity)}`);
    } else if (manufactured) {
      lines.push(`I can't verify that ${label} is currently in production. I can only verify completed manufacturing records right now.`);
      lines.push(`Completed quantity recorded: ${formatNumber(summary.total_completed_quantity)}`);
      lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
      if (latestCompletion) {
        lines.push(`Latest completion: ${latestCompletion}`);
      }
    } else {
      lines.push(`I don't know if ${label} is currently in production because I could not find linked active or completed job cards for it.`);
    }
  } else if (focus === 'progress') {
    const progressPercent = calculateProgressPercent(
      summary.total_completed_quantity,
      summary.total_planned_quantity,
      summary.completed_job_cards,
      summary.completed_job_cards + summary.active_job_cards
    );

    lines.push(`Production progress for ${label}: ${formatPercent(progressPercent)}%`);
    lines.push(`Completed quantity recorded: ${formatNumber(summary.total_completed_quantity)} of ${formatNumber(summary.total_planned_quantity)}`);
    lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)} of ${formatNumber(summary.completed_job_cards + summary.active_job_cards)}`);
    if (summary.active_job_cards > 0) {
      lines.push(`${label} is still in production.`);
    } else if (manufactured) {
      lines.push(`${label} has no active linked job cards remaining.`);
    } else {
      lines.push(`I can't verify meaningful progress for ${label} because there are no linked active or completed job cards.`);
    }
    if (latestCompletion) {
      lines.push(`Latest completion: ${latestCompletion}`);
    }
  } else {
    lines.push(
      manufactured
        ? `Yes, ${label} has been manufactured.`
        : summary.active_job_cards > 0
          ? `${label} is in production, but I cannot verify a completed manufacturing record yet.`
          : `I don't know if ${label} has been manufactured because I could not find a completed or active job card for it.`
    );
    lines.push(`Completed quantity recorded: ${formatNumber(summary.total_completed_quantity)}`);
    lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
    lines.push(`Open job cards: ${formatNumber(summary.active_job_cards)}`);

    if (latestCompletion) {
      lines.push(`Latest completion: ${latestCompletion}`);
    }

    if (summary.latest_completed_by) {
      lines.push(`Latest completed by: ${summary.latest_completed_by}`);
    }

    if (latestCompletedOrder) {
      lines.push(`Latest completed order: ${latestCompletedOrder}`);
    }
  }

  if (focus === 'who' || focus === 'when') {
    lines.push(`Completed quantity recorded: ${formatNumber(summary.total_completed_quantity)}`);
    lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
    lines.push(`Open job cards: ${formatNumber(summary.active_job_cards)}`);
  }

  appendRecentCompletions(lines, summary);

  return lines.join('\n');
}

export function buildOrderManufacturingAnswer(
  summary: AssistantOrderManufacturingSummary,
  options?: { focus?: AssistantManufacturingFocus | null }
) {
  if (summary.kind === 'ambiguous') {
    return `I found multiple possible orders for "${summary.order_ref}". Which one did you mean?`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find an order matching "${summary.order_ref}".`;
  }

  const focus = options?.focus ?? 'status';
  const label = buildOrderLabel(summary.order);
  const hasCompletedWork = summary.completed_job_cards > 0 || summary.total_completed_quantity > 0;
  const hasActiveWork = summary.active_job_cards > 0;
  const latestCompletion =
    summary.latest_completion_date ? formatDateTimeForAnswer(summary.latest_completion_date) : null;
  const lines: string[] = [];

  if (focus === 'who') {
    if (summary.latest_completed_by) {
      lines.push(`The latest verified manufacturing completion for ${label} was done by ${summary.latest_completed_by}.`);
      if (latestCompletion) {
        lines.push(`Latest completion: ${latestCompletion}`);
      }
    } else if (hasActiveWork) {
      lines.push(
        `I can't verify who completed ${label} yet because it is still in production and there is no verified completed manufacturing record for this order.`
      );
    } else {
      lines.push(
        `I don't know who manufactured ${label} because I could not find a verified completed manufacturing record for this order.`
      );
    }
  } else if (focus === 'when') {
    if (latestCompletion) {
      lines.push(`The latest verified manufacturing completion for ${label} was on ${latestCompletion}.`);
      if (summary.latest_completed_by) {
        lines.push(`Latest completed by: ${summary.latest_completed_by}`);
      }
    } else if (hasActiveWork) {
      lines.push(
        `I can't verify when ${label} was completed because it is still in production and there is no verified completed manufacturing record yet.`
      );
    } else {
      lines.push(
        `I don't know when ${label} was completed because I could not find a verified completed manufacturing record for this order.`
      );
    }
  } else if (focus === 'in_production') {
    if (hasActiveWork) {
      lines.push(`Yes, ${label} is currently in production.`);
      lines.push(`Open job cards: ${formatNumber(summary.active_job_cards)}`);
      lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
    } else if (hasCompletedWork) {
      lines.push(`I can't verify that ${label} is currently in production. I can only verify completed manufacturing records right now.`);
      lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
      if (latestCompletion) {
        lines.push(`Latest completion: ${latestCompletion}`);
      }
    } else {
      lines.push(`I don't know if ${label} is currently in production because I could not find linked job cards for this order.`);
    }
  } else if (focus === 'progress') {
    const progressPercent = calculateProgressPercent(
      summary.total_completed_quantity,
      summary.total_planned_quantity,
      summary.completed_job_cards,
      summary.total_job_cards
    );

    lines.push(`Production progress for ${label}: ${formatPercent(progressPercent)}%`);
    lines.push(`Completed quantity recorded: ${formatNumber(summary.total_completed_quantity)} of ${formatNumber(summary.total_planned_quantity)}`);
    lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)} of ${formatNumber(summary.total_job_cards)}`);
    if (hasActiveWork) {
      lines.push(`${label} is still in production.`);
    } else if (hasCompletedWork) {
      lines.push(`${label} has no active job cards remaining.`);
    } else {
      lines.push(`I can't verify meaningful progress for ${label} because I could not find linked job cards for this order.`);
    }
    if (latestCompletion) {
      lines.push(`Latest completion: ${latestCompletion}`);
    }
  } else {
    if (hasCompletedWork && !hasActiveWork) {
      lines.push(`Yes, ${label} has verified completed manufacturing records and no active job cards remain.`);
    } else if (hasCompletedWork && hasActiveWork) {
      lines.push(`I can verify completed manufacturing work for ${label}, but it is still in production.`);
    } else if (hasActiveWork) {
      lines.push(`${label} is in production, but I cannot verify a completed manufacturing record yet.`);
    } else {
      lines.push(`I don't know if ${label} has been manufactured because I could not find linked job cards for this order.`);
    }

    lines.push(`Total job cards: ${formatNumber(summary.total_job_cards)}`);
    lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
    lines.push(`Open job cards: ${formatNumber(summary.active_job_cards)}`);
  }

  if (focus === 'who' || focus === 'when') {
    lines.push(`Total job cards: ${formatNumber(summary.total_job_cards)}`);
    lines.push(`Completed job cards: ${formatNumber(summary.completed_job_cards)}`);
    lines.push(`Open job cards: ${formatNumber(summary.active_job_cards)}`);
  }

  if (summary.related_products.length > 0) {
    lines.push(`Related products: ${summary.related_products.join(', ')}`);
  }

  if (summary.recent_completions.length > 0) {
    lines.push('');
    lines.push('Recent order manufacturing completions:');
    for (const item of summary.recent_completions.slice(0, 3)) {
      const when = item.completion_date ? formatDateTimeForAnswer(item.completion_date) : 'Unknown date';
      const who = item.completed_by ?? 'Unknown staff';
      const products =
        item.product_labels.length > 0 ? ` — ${item.product_labels.join(', ')}` : '';
      lines.push(
        `- ${when} — ${who}${products} — qty ${formatNumber(item.completed_quantity)}`
      );
    }
  }

  return lines.join('\n');
}

export function buildManufacturingProgressCard(
  summary: AssistantManufacturingSummary | AssistantOrderManufacturingSummary
): AssistantCard | undefined {
  if (summary.kind !== 'summary') {
    return undefined;
  }

  if ('product' in summary) {
    const label = buildProductLabel(summary.product);
    const progressPercent = calculateProgressPercent(
      summary.total_completed_quantity,
      summary.total_planned_quantity,
      summary.completed_job_cards,
      summary.completed_job_cards + summary.active_job_cards
    );

    return {
      type: 'table',
      title: `Production progress for ${summary.product.internal_code ?? summary.product.name ?? summary.product.product_id}`,
      description: label,
      metrics: [
        {
          label: 'Progress',
          value: `${formatPercent(progressPercent)}%`,
        },
        {
          label: 'Completed qty',
          value: formatNumber(summary.total_completed_quantity),
        },
        {
          label: 'Planned qty',
          value: formatNumber(summary.total_planned_quantity),
        },
        {
          label: 'Open job cards',
          value: formatNumber(summary.active_job_cards),
        },
      ],
      columns: [
        { key: 'completed', label: 'Completed' },
        { key: 'by', label: 'Completed by' },
        { key: 'order', label: 'Order' },
        { key: 'qty', label: 'Qty', align: 'right' },
      ],
      rows:
        summary.recent_completions.length > 0
          ? summary.recent_completions.map(item => ({
              completed: item.completion_date ? formatDateTimeForAnswer(item.completion_date) : 'Unknown date',
              by: item.completed_by ?? 'Unknown staff',
              order:
                item.order_number
                  ? `${item.order_number}${item.customer_name ? ` (${item.customer_name})` : ''}`
                  : 'No order linked',
              qty: formatNumber(item.completed_quantity),
            }))
          : [{ completed: 'No completions yet', by: '-', order: '-', qty: '0' }],
      footer:
        summary.active_job_cards > 0
          ? 'This product still has active job cards in production.'
          : 'No active linked job cards remain for this product.',
    };
  }

  const label = buildOrderLabel(summary.order);
  const progressPercent = calculateProgressPercent(
    summary.total_completed_quantity,
    summary.total_planned_quantity,
    summary.completed_job_cards,
    summary.total_job_cards
  );

  return {
    type: 'table',
    title: `Production progress for ${summary.order.order_number ?? summary.order.order_id}`,
    description: label,
    metrics: [
      {
        label: 'Progress',
        value: `${formatPercent(progressPercent)}%`,
      },
      {
        label: 'Completed qty',
        value: formatNumber(summary.total_completed_quantity),
      },
      {
        label: 'Planned qty',
        value: formatNumber(summary.total_planned_quantity),
      },
      {
        label: 'Open job cards',
        value: formatNumber(summary.active_job_cards),
      },
    ],
    columns: [
      { key: 'completed', label: 'Completed' },
      { key: 'by', label: 'Completed by' },
      { key: 'products', label: 'Products' },
      { key: 'qty', label: 'Qty', align: 'right' },
    ],
    rows:
      summary.recent_completions.length > 0
        ? summary.recent_completions.map(item => ({
            completed: item.completion_date ? formatDateTimeForAnswer(item.completion_date) : 'Unknown date',
            by: item.completed_by ?? 'Unknown staff',
            products: item.product_labels.length > 0 ? item.product_labels.join(', ') : 'No products linked',
            qty: formatNumber(item.completed_quantity),
          }))
        : [{ completed: 'No completions yet', by: '-', products: '-', qty: '0' }],
    footer:
      summary.active_job_cards > 0
        ? 'This order still has active job cards in production.'
        : 'No active job cards remain for this order.',
  };
}

export function buildOrderJobCardsAnswer(summary: AssistantOrderManufacturingSummary) {
  if (summary.kind === 'ambiguous') {
    return `I found multiple possible orders for "${summary.order_ref}". Which one did you mean?`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find an order matching "${summary.order_ref}".`;
  }

  const label = buildOrderLabel(summary.order);
  if (summary.job_cards.length === 0) {
    return `There are no job cards currently attached to ${label}.`;
  }

  const lines = [
    `Job cards attached to ${label}: ${formatNumber(summary.total_job_cards)}`,
    `Open job cards: ${formatNumber(summary.active_job_cards)}`,
    `Completed job cards: ${formatNumber(summary.completed_job_cards)}`,
    '',
    'Attached job cards:',
  ];

  for (const jobCard of summary.job_cards.slice(0, 6)) {
    const products =
      jobCard.product_labels.length > 0 ? ` — ${jobCard.product_labels.join(', ')}` : '';
    lines.push(
      `- JC-${jobCard.job_card_id} | ${formatJobCardStatus(jobCard.status)} | ${
        jobCard.staff_name ?? 'Unassigned'
      }${products}`
    );
  }

  return lines.join('\n');
}

export function buildOrderJobCardsCard(
  summary: Extract<AssistantOrderManufacturingSummary, { kind: 'summary' }>
): AssistantCard {
  const orderLabel = summary.order.order_number?.trim() || `Order ${summary.order.order_id}`;

  return {
    type: 'table',
    title: `Job cards for ${orderLabel}`,
    description: 'All job cards currently linked to this customer order.',
    metrics: [
      {
        label: 'Total cards',
        value: formatNumber(summary.total_job_cards),
      },
      {
        label: 'Open cards',
        value: formatNumber(summary.active_job_cards),
      },
      {
        label: 'Completed cards',
        value: formatNumber(summary.completed_job_cards),
      },
      {
        label: 'Products',
        value: formatNumber(summary.related_products.length),
      },
    ],
    columns: [
      { key: 'job_card', label: 'Job card' },
      { key: 'status', label: 'Status' },
      { key: 'staff', label: 'Staff' },
      { key: 'products', label: 'Products' },
      { key: 'progress', label: 'Progress' },
    ],
    rows:
      summary.job_cards.length > 0
        ? summary.job_cards.map(jobCard => ({
            job_card: `JC-${jobCard.job_card_id}`,
            status: formatJobCardStatus(jobCard.status),
            staff: jobCard.staff_name ?? 'Unassigned',
            products:
              jobCard.product_labels.length > 0
                ? jobCard.product_labels.join(', ')
                : 'No products linked',
            progress: `${formatNumber(jobCard.completed_quantity)} / ${formatNumber(jobCard.planned_quantity)}`,
          }))
        : [
            {
              job_card: 'No job cards',
              status: 'Not set',
              staff: '—',
              products: '—',
              progress: '0 / 0',
            },
          ],
    rowActions:
      summary.job_cards.length > 0
        ? summary.job_cards.map(jobCard => [
            {
              label: 'Open job card',
              kind: 'navigate',
              href: `/staff/job-cards/${jobCard.job_card_id}`,
            },
          ])
        : undefined,
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
        label: 'Documents',
        kind: 'navigate',
        href: `/orders/${summary.order.order_id}?tab=documents`,
      },
      {
        label: 'Outstanding parts',
        kind: 'ask',
        prompt: `What is blocking order ${orderLabel}?`,
      },
    ],
    footer:
      summary.job_cards.length > 0
        ? 'Click a job-card row to open it, or use Outstanding parts to check supplier/component blockers.'
        : 'No job cards are currently attached to this order.',
  };
}

export function buildManufacturingStatusCard(
  summary: AssistantManufacturingSummary | AssistantOrderManufacturingSummary,
  focus?: AssistantManufacturingFocus | null
): AssistantCard | undefined {
  if (summary.kind !== 'summary') {
    return undefined;
  }

  const effectiveFocus = focus ?? 'status';

  if ('product' in summary) {
    const label = buildProductLabel(summary.product);
    const manufactured = summary.total_completed_quantity > 0 || summary.completed_job_cards > 0;

    return {
      type: 'table',
      title: `Manufacturing status for ${summary.product.internal_code ?? summary.product.name ?? summary.product.product_id}`,
      description: label,
      metrics: [
        {
          label: 'Status',
          value:
            effectiveFocus === 'in_production'
              ? summary.active_job_cards > 0
                ? 'In production'
                : manufactured
                  ? 'No active job cards'
                  : 'Unknown'
              : manufactured
                ? 'Manufactured'
                : summary.active_job_cards > 0
                  ? 'In production'
                  : 'Unknown',
        },
        {
          label: 'Completed qty',
          value: formatNumber(summary.total_completed_quantity),
        },
        {
          label: 'Completed cards',
          value: formatNumber(summary.completed_job_cards),
        },
        {
          label: 'Open job cards',
          value: formatNumber(summary.active_job_cards),
        },
      ],
      columns: [
        { key: 'latest_completion', label: 'Latest completion' },
        { key: 'completed_by', label: 'Completed by' },
        { key: 'order', label: 'Order' },
      ],
      rows: [
        {
          latest_completion: summary.latest_completion_date
            ? formatDateTimeForAnswer(summary.latest_completion_date)
            : 'No verified completion',
          completed_by: summary.latest_completed_by ?? 'Unknown staff',
          order:
            summary.latest_order_number
              ? `${summary.latest_order_number}${summary.latest_customer_name ? ` (${summary.latest_customer_name})` : ''}`
              : 'No order linked',
        },
      ],
      footer:
        effectiveFocus === 'who'
          ? 'Showing the latest verified completed-by record for this product.'
          : effectiveFocus === 'when'
            ? 'Showing the latest verified completion timestamp for this product.'
            : effectiveFocus === 'in_production'
              ? summary.active_job_cards > 0
                ? 'This product still has active job cards in production.'
                : 'No active linked job cards are currently recorded for this product.'
              : 'Showing the latest verified manufacturing status for this product.',
    };
  }

  const label = buildOrderLabel(summary.order);
  const hasCompletedWork = summary.completed_job_cards > 0 || summary.total_completed_quantity > 0;

  return {
    type: 'table',
    title: `Manufacturing status for ${summary.order.order_number ?? summary.order.order_id}`,
    description: label,
    metrics: [
      {
        label: 'Status',
        value:
          effectiveFocus === 'in_production'
            ? summary.active_job_cards > 0
              ? 'In production'
              : hasCompletedWork
                ? 'No active job cards'
                : 'Unknown'
            : hasCompletedWork && !summary.active_job_cards
              ? 'Manufactured'
              : summary.active_job_cards > 0
                ? 'In production'
                : hasCompletedWork
                  ? 'Partially completed'
                  : 'Unknown',
      },
      {
        label: 'Total cards',
        value: formatNumber(summary.total_job_cards),
      },
      {
        label: 'Completed cards',
        value: formatNumber(summary.completed_job_cards),
      },
      {
        label: 'Open job cards',
        value: formatNumber(summary.active_job_cards),
      },
    ],
    columns: [
      { key: 'latest_completion', label: 'Latest completion' },
      { key: 'completed_by', label: 'Completed by' },
      { key: 'products', label: 'Products' },
    ],
    rows: [
      {
        latest_completion: summary.latest_completion_date
          ? formatDateTimeForAnswer(summary.latest_completion_date)
          : 'No verified completion',
        completed_by: summary.latest_completed_by ?? 'Unknown staff',
        products: summary.related_products.length > 0 ? summary.related_products.join(', ') : 'No products linked',
      },
    ],
    footer:
      effectiveFocus === 'who'
        ? 'Showing the latest verified completed-by record for this order.'
        : effectiveFocus === 'when'
          ? 'Showing the latest verified completion timestamp for this order.'
          : effectiveFocus === 'in_production'
            ? summary.active_job_cards > 0
              ? 'This order still has active job cards in production.'
              : 'No active job cards are currently recorded for this order.'
            : 'Showing the latest verified manufacturing status for this order.',
  };
}

export function buildManufacturingOrderListAnswer(
  summary:
    | AssistantManufacturingOrderListSummary
    | AssistantManufacturingStaffingSummary
    | AssistantUnassignedProductionWorkSummary
) {
  const lines: string[] = [];

  if (summary.kind === 'unassigned_production_work') {
    lines.push(`Orders with unassigned production work: ${formatNumber(summary.order_count)}`);
    lines.push(`Unassigned active job cards: ${formatNumber(summary.unassigned_job_cards)}`);

    if (summary.orders.length === 0) {
      lines.push('No active production job cards are currently unassigned.');
      return lines.join('\n');
    }

    lines.push('');
    lines.push('Orders needing assignment:');
    for (const order of summary.orders) {
      lines.push(`- ${buildOrderLabel(order)}: ${formatNumber(order.active_job_cards)} unassigned job cards`);
    }
    return lines.join('\n');
  }

  if (summary.kind === 'production_staffing') {
    lines.push(`Staff currently assigned to orders in production: ${formatNumber(summary.staff_count)}`);
    lines.push(`Orders with active job cards: ${formatNumber(summary.order_count)}`);
    lines.push(`Unassigned active job cards: ${formatNumber(summary.unassigned_job_cards)}`);

    if (summary.assignments.length === 0) {
      lines.push('No active production staffing is recorded right now.');
      return lines.join('\n');
    }

    lines.push('');
    lines.push('Current production staffing:');
    for (const assignment of summary.assignments) {
      const staffLabel = assignment.staff_name ?? 'Unassigned';
      const orderDetails = assignment.orders
        .map(order => `${buildOrderLabel(order)} (${formatNumber(order.active_job_cards)})`)
        .join(', ');
      lines.push(
        `- ${staffLabel}: ${formatNumber(assignment.active_job_cards)} active job cards${orderDetails ? ` — ${orderDetails}` : ''}`
      );
    }
    return lines.join('\n');
  }

  if (summary.kind === 'orders_in_production') {
    lines.push(`Orders currently in production: ${formatNumber(summary.order_count)}`);
    if (summary.orders.length === 0) {
      lines.push('No orders currently have active linked job cards.');
      return lines.join('\n');
    }

    lines.push('');
    lines.push('Active manufacturing orders:');
    for (const order of summary.orders) {
      const label = buildOrderLabel(order);
      const products = order.related_products.length > 0 ? ` — ${order.related_products.join(', ')}` : '';
      lines.push(`- ${label}: ${formatNumber(order.active_job_cards)} open job cards${products}`);
    }
    return lines.join('\n');
  }

  const weekLabel =
    summary.week_start && summary.week_end
      ? `${formatDateTimeForAnswer(summary.week_start).split(',')[0]} to ${formatDateTimeForAnswer(summary.week_end).split(',')[0]}`
      : 'this week';
  lines.push(`Orders finished this week: ${formatNumber(summary.order_count)}`);
  lines.push(`Week: ${weekLabel}`);

  if (summary.orders.length === 0) {
    lines.push('No linked order manufacturing completions were recorded this week.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Completed orders this week:');
  for (const order of summary.orders) {
    const label = buildOrderLabel(order);
    const completion = order.latest_completion_date
      ? formatDateTimeForAnswer(order.latest_completion_date).split(',')[0]
      : 'Unknown date';
    const who = order.latest_completed_by ? ` — ${order.latest_completed_by}` : '';
    const products = order.related_products.length > 0 ? ` — ${order.related_products.join(', ')}` : '';
    lines.push(`- ${label}: completed ${completion}${who}${products}`);
  }

  return lines.join('\n');
}

export function buildProductionStaffingCard(
  summary: AssistantManufacturingStaffingSummary
): AssistantCard {
  return {
    type: 'table',
    title: 'Production staffing',
    description: 'Live active job-card assignments grouped by staff member.',
    metrics: [
      {
        label: 'Staff assigned',
        value: formatNumber(summary.staff_count),
      },
      {
        label: 'Orders active',
        value: formatNumber(summary.order_count),
      },
      {
        label: 'Unassigned cards',
        value: formatNumber(summary.unassigned_job_cards),
      },
    ],
    columns: [
      { key: 'staff', label: 'Staff' },
      { key: 'order', label: 'Order' },
      { key: 'job_cards', label: 'Active Job Cards', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.assignments.flatMap(assignment =>
      assignment.orders.map(order => ({
        staff: assignment.staff_name ?? 'Unassigned',
        order: buildOrderLabel(order),
        job_cards: formatNumber(order.active_job_cards),
        status: assignment.staff_name ? 'Assigned' : 'Needs assignment',
      }))
    ),
    footer:
      summary.unassigned_job_cards > 0
        ? 'Unassigned work should be allocated before production slips.'
        : 'All active production job cards have a staff assignment.',
  };
}

export function buildUnassignedProductionWorkCard(
  summary: AssistantUnassignedProductionWorkSummary
): AssistantCard {
  return {
    type: 'table',
    title: 'Unassigned production work',
    description: 'Active production job cards with no staff assignment yet.',
    metrics: [
      {
        label: 'Orders waiting',
        value: formatNumber(summary.order_count),
      },
      {
        label: 'Unassigned cards',
        value: formatNumber(summary.unassigned_job_cards),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'job_cards', label: 'Unassigned Job Cards', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows: summary.orders.map(order => ({
      order: buildOrderLabel(order),
      job_cards: formatNumber(order.active_job_cards),
      status: 'Needs assignment',
    })),
    footer:
      summary.unassigned_job_cards > 0
        ? 'Assign these job cards before they become a production bottleneck.'
        : 'All active production work currently has an assigned staff member.',
  };
}
