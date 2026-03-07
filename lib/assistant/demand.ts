import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getRelationRecord,
  resolveAssistantComponent,
  type AssistantComponentLookupResult,
} from '@/lib/assistant/component-resolver';
import {
  getInventoryItemSnapshot,
  type AssistantInventorySnapshot,
} from '@/lib/assistant/inventory';

type OrderStatusRelation = {
  status_name?: string | null;
};

type CustomerRelation = {
  name?: string | null;
};

type OrderRelation = {
  order_id: number;
  order_number?: string | null;
  delivery_date?: string | null;
  status?: OrderStatusRelation | OrderStatusRelation[] | null;
  customer?: CustomerRelation | CustomerRelation[] | null;
};

type OrderDetailRow = {
  order_id: number;
  product_id?: number | null;
  quantity?: number | string | null;
  order?: OrderRelation | OrderRelation[] | null;
};

type BomRow = {
  product_id: number;
  quantity_required?: number | string | null;
};

type ReservationRow = {
  order_id: number;
  qty_reserved?: number | string | null;
};

type OrderStatusRpcRow = {
  component_id?: number | null;
  order_required?: number | string | null;
  reserved_this_order?: number | string | null;
  reserved_by_others?: number | string | null;
  apparent_shortfall?: number | string | null;
  real_shortfall?: number | string | null;
};

const ORDER_DEMAND_RPC_CONCURRENCY = 6;

export type AssistantDemandIntent = 'orders_needing_item' | 'enough_for_open_demand';

type AssistantDemandComponent = {
  component_id: number;
  internal_code: string;
  description: string | null;
};

type AssistantDemandOrderSummary = {
  order_id: number;
  order_number: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  status_name: string | null;
  required_qty: number;
  reserved_qty: number;
  apparent_shortfall: number;
  real_shortfall: number;
  coverage_state: 'ready_now' | 'waiting_on_deliveries' | 'blocked_now';
};

export type AssistantItemDemandSummary =
  | {
      kind: 'summary';
      component: AssistantDemandComponent;
      inventory: AssistantInventorySnapshot;
      open_order_count: number;
      total_required_qty: number;
      total_reserved_for_orders: number;
      ready_now_count: number;
      waiting_on_deliveries_count: number;
      blocked_now_count: number;
      orders: AssistantDemandOrderSummary[];
    }
  | {
      kind: 'no_demand';
      component: AssistantDemandComponent;
      inventory: AssistantInventorySnapshot;
    }
  | Exclude<AssistantComponentLookupResult, { kind: 'resolved' }>;

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDateForAnswer(value: string) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function isTerminalStatus(statusName: string | null) {
  const normalized = statusName?.trim().toLowerCase() ?? '';
  return normalized === 'completed' || normalized === 'cancelled';
}

export function detectDemandIntent(message: string): AssistantDemandIntent | null {
  const normalized = message.toLowerCase();

  if (
    /\b(enough|cover|coverage|sufficient)\b/.test(normalized) &&
    /\b(open demand|demand|open orders|orders)\b/.test(normalized)
  ) {
    return 'enough_for_open_demand';
  }

  if (
    /\b(which orders need|which customer orders need|what orders need|needed for which orders|needed for these orders|what is .* needed for|who needs)\b/.test(
      normalized
    )
  ) {
    return 'orders_needing_item';
  }

  return null;
}

export function extractDemandComponentReference(message: string) {
  let value = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  value = value.replace(/^(how much|how many|what(?:'s| is)|which|show|list|tell me|please|can)\s+/i, '');
  value = value.replace(/\b(do we have|can we|is there|are there)\b/gi, ' ');
  value = value.replace(
    /\b(which orders need|which customer orders need|what orders need|needed for which orders|needed for these orders|needed for|what is|who needs|enough|cover|coverage|sufficient|open demand|demand|open orders|orders)\b/gi,
    ' '
  );
  value = value.replace(/\b(right now|currently|today)\b/gi, ' ');
  value = value.replace(/\b(is|are|was|were|for)\b/gi, ' ');
  value = value.replace(/^(of|the|a|an)\s+/i, '');
  value = value.replace(/\b(of|the|a|an)\s*$/i, '');
  value = value.replace(/\s+/g, ' ').trim();

  return value;
}

function formatComponentLabel(component: AssistantDemandComponent) {
  return component.description
    ? `${component.internal_code} - ${component.description}`
    : component.internal_code;
}

async function loadExactOrderDemand(
  supabase: SupabaseClient,
  orderIds: number[],
  componentId: number
) {
  const demandByOrderId = new Map<
    number,
    {
      required_qty: number;
      reserved_qty: number;
      apparent_shortfall: number;
      real_shortfall: number;
      coverage_state: 'ready_now' | 'waiting_on_deliveries' | 'blocked_now';
    }
  >();

  for (let index = 0; index < orderIds.length; index += ORDER_DEMAND_RPC_CONCURRENCY) {
    const chunk = orderIds.slice(index, index + ORDER_DEMAND_RPC_CONCURRENCY);

    await Promise.all(
      chunk.map(async orderId => {
      const { data, error } = await supabase.rpc('get_detailed_component_status', {
        p_order_id: orderId,
      });

      if (error) {
        throw error;
      }

      const row = ((data ?? []) as OrderStatusRpcRow[]).find(
        item => item.component_id === componentId
      );
      if (!row) {
        return;
      }

      const realShortfall = toNumber(row.real_shortfall);
      const apparentShortfall = toNumber(row.apparent_shortfall);
      const coverageState =
        realShortfall > 0
          ? 'blocked_now'
          : apparentShortfall > 0
            ? 'waiting_on_deliveries'
            : 'ready_now';

      demandByOrderId.set(orderId, {
        required_qty: toNumber(row.order_required),
        reserved_qty: toNumber(row.reserved_this_order),
        apparent_shortfall: apparentShortfall,
        real_shortfall: realShortfall,
        coverage_state: coverageState,
      });
      })
    );
  }

  return demandByOrderId;
}

export async function getItemDemandSummary(
  supabase: SupabaseClient,
  componentRef: string
): Promise<AssistantItemDemandSummary> {
  const resolved = await resolveAssistantComponent(supabase, componentRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const inventoryResult = await getInventoryItemSnapshot(
    supabase,
    resolved.component.internal_code ?? componentRef
  );
  if (inventoryResult.kind !== 'snapshot') {
    return inventoryResult;
  }

  const component = {
    component_id: resolved.component.component_id,
    internal_code:
      resolved.component.internal_code ?? `Component ${resolved.component.component_id}`,
    description: resolved.component.description ?? null,
  };

  const { data: bomRows, error: bomError } = await supabase
    .from('billofmaterials')
    .select('product_id, quantity_required')
    .eq('component_id', component.component_id);

  if (bomError) {
    throw bomError;
  }

  const bomByProductId = new Map<number, number>();
  for (const row of (bomRows ?? []) as BomRow[]) {
    const existing = bomByProductId.get(row.product_id) ?? 0;
    bomByProductId.set(row.product_id, existing + toNumber(row.quantity_required));
  }

  const productIds = Array.from(bomByProductId.keys());

  const candidateOrderMeta = new Map<
    number,
    {
      order_id: number;
      order_number: string | null;
      customer_name: string | null;
      delivery_date: string | null;
      status_name: string | null;
      estimated_required_qty: number;
    }
  >();

  if (productIds.length > 0) {
    const { data: orderDetailRows, error: orderDetailsError } = await supabase
      .from('order_details')
      .select(
        'order_id, product_id, quantity, order:orders(order_id, order_number, delivery_date, status:order_statuses(status_name), customer:customers(name))'
      )
      .in('product_id', productIds);

    if (orderDetailsError) {
      throw orderDetailsError;
    }

    for (const row of (orderDetailRows ?? []) as OrderDetailRow[]) {
      const order = getRelationRecord(row.order);
      const status = getRelationRecord(order?.status);
      const customer = getRelationRecord(order?.customer);
      const statusName = status?.status_name?.trim() || null;
      if (!order || isTerminalStatus(statusName)) {
        continue;
      }

      const bomQty = bomByProductId.get(row.product_id ?? -1) ?? 0;
      const requiredQty = toNumber(row.quantity) * bomQty;
      const existing = candidateOrderMeta.get(order.order_id);
      if (existing) {
        existing.estimated_required_qty += requiredQty;
      } else {
        candidateOrderMeta.set(order.order_id, {
          order_id: order.order_id,
          order_number: order.order_number?.trim() || null,
          customer_name: customer?.name?.trim() || null,
          delivery_date: order.delivery_date?.slice(0, 10) || null,
          status_name: statusName,
          estimated_required_qty: requiredQty,
        });
      }
    }
  }

  const { data: reservationRows, error: reservationError } = await supabase
    .from('component_reservations')
    .select('order_id, qty_reserved')
    .eq('component_id', component.component_id);

  if (reservationError) {
    throw reservationError;
  }

  const reservationByOrderId = new Map<number, number>();
  for (const row of (reservationRows ?? []) as ReservationRow[]) {
    reservationByOrderId.set(row.order_id, toNumber(row.qty_reserved));
  }

  const candidateOrderIds = Array.from(
    new Set([
      ...candidateOrderMeta.keys(),
      ...reservationByOrderId.keys(),
    ])
  );

  if (candidateOrderIds.length === 0) {
    return {
      kind: 'no_demand',
      component,
      inventory: inventoryResult.snapshot,
    };
  }

  const missingMetaIds = candidateOrderIds.filter(orderId => !candidateOrderMeta.has(orderId));
  if (missingMetaIds.length > 0) {
    const { data: orderRows, error: orderRowsError } = await supabase
      .from('orders')
      .select('order_id, order_number, delivery_date, status:order_statuses(status_name), customer:customers(name)')
      .in('order_id', missingMetaIds);

    if (orderRowsError) {
      throw orderRowsError;
    }

    for (const row of (orderRows ?? []) as OrderRelation[]) {
      const status = getRelationRecord(row.status);
      const customer = getRelationRecord(row.customer);
      const statusName = status?.status_name?.trim() || null;
      if (isTerminalStatus(statusName)) {
        continue;
      }

      candidateOrderMeta.set(row.order_id, {
        order_id: row.order_id,
        order_number: row.order_number?.trim() || null,
        customer_name: customer?.name?.trim() || null,
        delivery_date: row.delivery_date?.slice(0, 10) || null,
        status_name: statusName,
        estimated_required_qty: 0,
      });
    }
  }

  const exactDemandByOrderId = await loadExactOrderDemand(
    supabase,
    Array.from(candidateOrderMeta.keys()),
    component.component_id
  );

  const orders = Array.from(candidateOrderMeta.values())
    .map(order => {
      const exact = exactDemandByOrderId.get(order.order_id);
      if (!exact && order.estimated_required_qty <= 0 && (reservationByOrderId.get(order.order_id) ?? 0) <= 0) {
        return null;
      }

      const requiredQty = exact?.required_qty ?? order.estimated_required_qty;
      const reservedQty = exact?.reserved_qty ?? (reservationByOrderId.get(order.order_id) ?? 0);
      const apparentShortfall = exact?.apparent_shortfall ?? Math.max(requiredQty - reservedQty, 0);
      const realShortfall = exact?.real_shortfall ?? apparentShortfall;
      const coverageState =
        exact?.coverage_state ??
        (realShortfall > 0
          ? 'blocked_now'
          : apparentShortfall > 0
            ? 'waiting_on_deliveries'
            : 'ready_now');

      return {
        order_id: order.order_id,
        order_number: order.order_number,
        customer_name: order.customer_name,
        delivery_date: order.delivery_date,
        status_name: order.status_name,
        required_qty: requiredQty,
        reserved_qty: reservedQty,
        apparent_shortfall: apparentShortfall,
        real_shortfall: realShortfall,
        coverage_state: coverageState,
      } satisfies AssistantDemandOrderSummary;
    })
    .filter((order): order is AssistantDemandOrderSummary => order != null)
    .sort((a, b) => {
      if (a.delivery_date && b.delivery_date) {
        return a.delivery_date.localeCompare(b.delivery_date);
      }
      if (a.delivery_date) return -1;
      if (b.delivery_date) return 1;
      return a.order_id - b.order_id;
    });

  if (orders.length === 0) {
    return {
      kind: 'no_demand',
      component,
      inventory: inventoryResult.snapshot,
    };
  }

  return {
    kind: 'summary',
    component,
    inventory: inventoryResult.snapshot,
    open_order_count: orders.length,
    total_required_qty: orders.reduce((sum, order) => sum + order.required_qty, 0),
    total_reserved_for_orders: orders.reduce((sum, order) => sum + order.reserved_qty, 0),
    ready_now_count: orders.filter(order => order.coverage_state === 'ready_now').length,
    waiting_on_deliveries_count: orders.filter(
      order => order.coverage_state === 'waiting_on_deliveries'
    ).length,
    blocked_now_count: orders.filter(order => order.coverage_state === 'blocked_now').length,
    orders,
  };
}

export function buildOrdersNeedingItemAnswer(summary: AssistantItemDemandSummary) {
  if (summary.kind === 'ambiguous') {
    return `I found multiple possible components for "${summary.component_ref}". Which one did you mean?`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find a component matching "${summary.component_ref}" in Unity.`;
  }

  if (summary.kind === 'no_demand') {
    return `I don't know of any open verified customer orders currently requiring ${formatComponentLabel(summary.component)}.`;
  }

  const lines = [
    `Item: ${formatComponentLabel(summary.component)}`,
    `Open customer orders needing this item: ${formatNumber(summary.open_order_count)}`,
    `Tracked open demand: ${formatNumber(summary.total_required_qty)}`,
    `Reserved for those orders: ${formatNumber(summary.total_reserved_for_orders)}`,
    `On hand: ${formatNumber(summary.inventory.on_hand)}`,
    `On order: ${formatNumber(summary.inventory.on_order)}`,
  ];

  lines.push('');
  lines.push('Orders needing this item:');
  for (const order of summary.orders.slice(0, 5)) {
    const orderLabel = order.order_number?.trim() || `Order ${order.order_id}`;
    const customerLabel = order.customer_name?.trim() || 'Unknown customer';
    const dueLabel = order.delivery_date ? formatDateForAnswer(order.delivery_date) : 'No delivery date';
    const coverageLabel =
      order.coverage_state === 'blocked_now'
        ? 'blocked now'
        : order.coverage_state === 'waiting_on_deliveries'
          ? 'waiting on deliveries'
          : 'ready now';

    lines.push(
      `- ${orderLabel} (${customerLabel}) due ${dueLabel} | required ${formatNumber(order.required_qty)} | reserved ${formatNumber(order.reserved_qty)} | ${coverageLabel}`
    );
  }

  return lines.join('\n');
}

export function buildDemandCoverageAnswer(summary: AssistantItemDemandSummary) {
  if (summary.kind === 'ambiguous') {
    return `I found multiple possible components for "${summary.component_ref}". Which one did you mean?`;
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find a component matching "${summary.component_ref}" in Unity.`;
  }

  if (summary.kind === 'no_demand') {
    return `I don't know of any open verified demand for ${formatComponentLabel(summary.component)} right now.`;
  }

  const lines = [
    `Item: ${formatComponentLabel(summary.component)}`,
    `Tracked open demand: ${formatNumber(summary.total_required_qty)}`,
    `On hand: ${formatNumber(summary.inventory.on_hand)}`,
    `Reserved: ${formatNumber(summary.inventory.reserved)}`,
    `Available now: ${formatNumber(summary.inventory.available)}`,
    `On order: ${formatNumber(summary.inventory.on_order)}`,
    `Orders ready now: ${formatNumber(summary.ready_now_count)}`,
    `Orders waiting on deliveries: ${formatNumber(summary.waiting_on_deliveries_count)}`,
    `Orders blocked now: ${formatNumber(summary.blocked_now_count)}`,
  ];

  lines.push('');
  if (summary.blocked_now_count > 0) {
    lines.push('Coverage: no, some open orders for this item are currently blocked by stock shortages.');
  } else if (summary.waiting_on_deliveries_count > 0) {
    lines.push('Coverage: partial, current demand is only fully covered once incoming supplier stock arrives.');
  } else {
    lines.push('Coverage: yes, current verified open demand for this item is covered.');
  }

  return lines.join('\n');
}
