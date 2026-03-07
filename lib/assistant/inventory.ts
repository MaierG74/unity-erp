import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantCard } from '@/lib/assistant/prompt-suggestions';

import {
  getRelationRecord,
  resolveAssistantComponent,
  type AssistantComponentLookupResult,
} from '@/lib/assistant/component-resolver';
import { SO_STATUS } from '@/types/purchasing';

type SupplierComponentRow = {
  supplier_component_id: number;
  supplier_id?: number | null;
  supplier?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

type SupplierOrderRow = {
  order_id: number;
  supplier_component_id: number;
  order_quantity?: number | string | null;
  total_received?: number | string | null;
  order_date?: string | null;
  purchase_order_id?: number | null;
  status_id?: number | null;
};

type PurchaseOrderRow = {
  purchase_order_id: number;
  q_number?: string | null;
};

type ReservationRow = {
  order_id: number;
  qty_reserved?: number | string | null;
};

type OrderRow = {
  order_id: number;
  order_number?: string | null;
  delivery_date?: string | null;
  status?: { status_name?: string | null } | Array<{ status_name?: string | null }> | null;
};

export type AssistantInventoryIntent = 'snapshot' | 'on_hand' | 'on_order' | 'reserved';

export type AssistantInventoryComponent = {
  component_id: number;
  internal_code: string;
  description: string | null;
  reorder_level: number | null;
  location: string | null;
};

export type AssistantInventorySnapshot = {
  component: AssistantInventoryComponent;
  on_hand: number;
  reserved: number;
  available: number;
  on_order: number;
  received_on_open_orders: number;
  open_supplier_order_count: number;
  open_purchase_order_count: number;
  supplier_breakdown: Array<{
    supplier_name: string;
    outstanding_quantity: number;
    supplier_order_count: number;
  }>;
  reservation_breakdown: Array<{
    order_id: number;
    order_number: string | null;
    qty_reserved: number;
    status_name: string | null;
    delivery_date: string | null;
  }>;
};

export type InventoryToolResult =
  | { kind: 'snapshot'; snapshot: AssistantInventorySnapshot }
  | Exclude<AssistantComponentLookupResult, { kind: 'resolved' }>;

function toNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getInventoryItemSnapshot(
  supabase: SupabaseClient,
  componentRef: string
): Promise<InventoryToolResult> {
  const resolved = await resolveAssistantComponent(supabase, componentRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const component = resolved.component;
  const inventory = getRelationRecord(component.inventory);
  const onHand = toNumber(inventory?.quantity_on_hand);
  const reorderLevelRaw = inventory?.reorder_level;
  const reorderLevel =
    reorderLevelRaw == null ? null : Number.isFinite(toNumber(reorderLevelRaw)) ? toNumber(reorderLevelRaw) : null;

  const { data: supplierComponentRows, error: supplierComponentError } = await supabase
    .from('suppliercomponents')
    .select('supplier_component_id, supplier_id, supplier:suppliers(name)')
    .eq('component_id', component.component_id);

  if (supplierComponentError) {
    throw supplierComponentError;
  }

  const supplierComponents = (supplierComponentRows ?? []) as SupplierComponentRow[];
  const supplierComponentIds = supplierComponents.map(row => row.supplier_component_id);
  const supplierNameById = new Map<number, string>();
  for (const row of supplierComponents) {
    const supplier = getRelationRecord(row.supplier);
    supplierNameById.set(row.supplier_component_id, supplier?.name?.trim() || 'Unknown supplier');
  }

  let supplierOrders: SupplierOrderRow[] = [];
  if (supplierComponentIds.length > 0) {
    const { data: supplierOrderRows, error: supplierOrderError } = await supabase
      .from('supplier_orders')
      .select('order_id, supplier_component_id, order_quantity, total_received, order_date, purchase_order_id, status_id')
      .in('supplier_component_id', supplierComponentIds)
      .in('status_id', [
        SO_STATUS.OPEN,
        SO_STATUS.IN_PROGRESS,
        SO_STATUS.PENDING_APPROVAL,
        SO_STATUS.APPROVED,
        SO_STATUS.PARTIALLY_RECEIVED,
      ]);

    if (supplierOrderError) {
      throw supplierOrderError;
    }

    supplierOrders = (supplierOrderRows ?? []) as SupplierOrderRow[];
  }

  const purchaseOrderIds = Array.from(
    new Set(
      supplierOrders
        .map(row => row.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );

  const validPurchaseOrderIds = new Set<number>();
  if (purchaseOrderIds.length > 0) {
    const { data: purchaseOrderRows, error: purchaseOrderError } = await supabase
      .from('purchase_orders')
      .select('purchase_order_id, q_number')
      .in('purchase_order_id', purchaseOrderIds);

    if (purchaseOrderError) {
      throw purchaseOrderError;
    }

    for (const row of (purchaseOrderRows ?? []) as PurchaseOrderRow[]) {
      validPurchaseOrderIds.add(row.purchase_order_id);
    }
  }

  const openSupplierOrders = supplierOrders.filter(row =>
    row.purchase_order_id != null ? validPurchaseOrderIds.has(row.purchase_order_id) : false
  );

  const supplierBreakdownMap = new Map<string, { outstanding_quantity: number; supplier_order_count: number }>();
  let onOrder = 0;
  let receivedOnOpenOrders = 0;

  for (const row of openSupplierOrders) {
    const orderedQty = toNumber(row.order_quantity);
    const receivedQty = toNumber(row.total_received);
    const outstandingQty = Math.max(orderedQty - receivedQty, 0);
    const supplierName = supplierNameById.get(row.supplier_component_id) ?? 'Unknown supplier';

    onOrder += outstandingQty;
    receivedOnOpenOrders += receivedQty;

    const current = supplierBreakdownMap.get(supplierName) ?? {
      outstanding_quantity: 0,
      supplier_order_count: 0,
    };
    current.outstanding_quantity += outstandingQty;
    current.supplier_order_count += 1;
    supplierBreakdownMap.set(supplierName, current);
  }

  const { data: reservationRows, error: reservationError } = await supabase
    .from('component_reservations')
    .select('order_id, qty_reserved')
    .eq('component_id', component.component_id);

  if (reservationError) {
    throw reservationError;
  }

  const reservations = (reservationRows ?? []) as ReservationRow[];
  const reserved = reservations.reduce((sum, row) => sum + toNumber(row.qty_reserved), 0);
  const available = onHand - reserved;

  const reservedOrderIds = Array.from(
    new Set(
      reservations
        .map(row => row.order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );

  const orderMetaById = new Map<number, OrderRow>();
  if (reservedOrderIds.length > 0) {
    const { data: orderRows, error: orderError } = await supabase
      .from('orders')
      .select('order_id, order_number, delivery_date, status:order_statuses(status_name)')
      .in('order_id', reservedOrderIds);

    if (orderError) {
      throw orderError;
    }

    for (const row of (orderRows ?? []) as OrderRow[]) {
      orderMetaById.set(row.order_id, row);
    }
  }

  const reservationBreakdown = reservations
    .map(row => {
      const orderMeta = orderMetaById.get(row.order_id);
      const status = getRelationRecord(orderMeta?.status);
      return {
        order_id: row.order_id,
        order_number: orderMeta?.order_number ?? null,
        qty_reserved: toNumber(row.qty_reserved),
        status_name: status?.status_name ?? null,
        delivery_date: orderMeta?.delivery_date ?? null,
      };
    })
    .sort((a, b) => b.qty_reserved - a.qty_reserved);

  return {
    kind: 'snapshot',
    snapshot: {
      component: {
        component_id: component.component_id,
        internal_code: component.internal_code ?? `Component ${component.component_id}`,
        description: component.description ?? null,
        reorder_level: reorderLevel,
        location: inventory?.location?.trim() || null,
      },
      on_hand: onHand,
      reserved,
      available,
      on_order: onOrder,
      received_on_open_orders: receivedOnOpenOrders,
      open_supplier_order_count: openSupplierOrders.length,
      open_purchase_order_count: validPurchaseOrderIds.size,
      supplier_breakdown: Array.from(supplierBreakdownMap.entries())
        .map(([supplier_name, details]) => ({
          supplier_name,
          outstanding_quantity: details.outstanding_quantity,
          supplier_order_count: details.supplier_order_count,
        }))
        .sort((a, b) => b.outstanding_quantity - a.outstanding_quantity),
      reservation_breakdown: reservationBreakdown,
    },
  };
}

export function detectInventoryIntent(message: string): AssistantInventoryIntent | null {
  const normalized = message.toLowerCase();
  const inventoryWords =
    /\b(stock|in stock|on hand|inventory|on order|reserved|allocation|allocated|supplier order|purchase order)\b/;

  if (!inventoryWords.test(normalized)) {
    return null;
  }

  if (/\b(on order|ordered|purchase order|supplier order|incoming)\b/.test(normalized)) {
    return 'on_order';
  }

  if (/\b(reserved|allocation|allocated|needed for orders|needed for these orders)\b/.test(normalized)) {
    return 'reserved';
  }

  if (/\b(in stock|on hand|have in stock|stock do we have)\b/.test(normalized)) {
    return 'on_hand';
  }

  return 'snapshot';
}

export function extractComponentReference(message: string) {
  let value = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  value = value.replace(/^(how much|how many|what(?:'s| is)|show|tell me|please)\s+/i, '');
  value = value.replace(/\bdo we have\b/gi, ' ');
  value = value.replace(
    /\b(in stock|on hand|on order|reserved|allocation|allocated|supplier order|supplier orders|purchase order|purchase orders|inventory|stock)\b/gi,
    ' '
  );
  value = value.replace(/\b(right now|currently|today|for open orders|for these orders)\b/gi, ' ');
  value = value.replace(/\b(is|are|was|were)\b/gi, ' ');
  value = value.replace(/^(of|for|the|a|an)\s+/i, '');
  value = value.replace(/\b(of|for|the|a|an)\s*$/i, '');
  value = value.replace(/\s+/g, ' ').trim();

  return value;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function buildInventoryAnswer(snapshot: AssistantInventorySnapshot, intent: AssistantInventoryIntent) {
  const label = snapshot.component.description
    ? `${snapshot.component.internal_code} - ${snapshot.component.description}`
    : snapshot.component.internal_code;

  const lines: string[] = [`Item: ${label}`];

  if (intent === 'on_hand') {
    lines.push(`On hand: ${formatNumber(snapshot.on_hand)}`);
    lines.push(`Reserved: ${formatNumber(snapshot.reserved)}`);
    lines.push(`Available now: ${formatNumber(snapshot.available)}`);
  } else if (intent === 'on_order') {
    lines.push(`On order: ${formatNumber(snapshot.on_order)}`);
    lines.push(`Received already on open supplier lines: ${formatNumber(snapshot.received_on_open_orders)}`);
    lines.push(`Open supplier orders: ${snapshot.open_supplier_order_count}`);
    lines.push(`Open purchase orders: ${snapshot.open_purchase_order_count}`);
  } else if (intent === 'reserved') {
    lines.push(`Reserved: ${formatNumber(snapshot.reserved)}`);
    lines.push(`On hand: ${formatNumber(snapshot.on_hand)}`);
    lines.push(`Available now: ${formatNumber(snapshot.available)}`);
  } else {
    lines.push(`On hand: ${formatNumber(snapshot.on_hand)}`);
    lines.push(`Reserved: ${formatNumber(snapshot.reserved)}`);
    lines.push(`Available now: ${formatNumber(snapshot.available)}`);
    lines.push(`On order: ${formatNumber(snapshot.on_order)}`);
    lines.push(`Received already on open supplier lines: ${formatNumber(snapshot.received_on_open_orders)}`);
    lines.push(`Open supplier orders: ${snapshot.open_supplier_order_count}`);
    lines.push(`Open purchase orders: ${snapshot.open_purchase_order_count}`);
  }

  if (snapshot.component.reorder_level != null && snapshot.component.reorder_level > 0) {
    lines.push(`Reorder level: ${formatNumber(snapshot.component.reorder_level)}`);
  }

  if (snapshot.component.location) {
    lines.push(`Location: ${snapshot.component.location}`);
  }

  if (snapshot.supplier_breakdown.length > 0 && intent !== 'reserved') {
    lines.push(
      `Suppliers: ${snapshot.supplier_breakdown
        .map(item => `${item.supplier_name} (${formatNumber(item.outstanding_quantity)})`)
        .join(', ')}`
    );
  }

  if (snapshot.reservation_breakdown.length > 0) {
    lines.push('');
    lines.push('Reserved for orders:');
    for (const row of snapshot.reservation_breakdown.slice(0, 5)) {
      const orderLabel = row.order_number?.trim() || `Order ${row.order_id}`;
      lines.push(`- ${orderLabel}: ${formatNumber(row.qty_reserved)}`);
    }
  }

  if (snapshot.available < 0) {
    lines.push('');
    lines.push('Warning: reserved quantity exceeds current on-hand stock.');
  }

  return lines.join('\n');
}

export function buildInventoryCard(
  snapshot: AssistantInventorySnapshot,
  intent: AssistantInventoryIntent
): AssistantCard {
  const label = snapshot.component.description
    ? `${snapshot.component.internal_code} - ${snapshot.component.description}`
    : snapshot.component.internal_code;

  if (intent === 'on_order') {
    return {
      type: 'table',
      title: `Inventory snapshot for ${snapshot.component.internal_code}`,
      description: label,
      metrics: [
        {
          label: 'On order',
          value: formatNumber(snapshot.on_order),
        },
        {
          label: 'Received',
          value: formatNumber(snapshot.received_on_open_orders),
        },
        {
          label: 'Open supplier orders',
          value: formatNumber(snapshot.open_supplier_order_count),
        },
      ],
      columns: [
        { key: 'supplier', label: 'Supplier' },
        { key: 'outstanding', label: 'On order', align: 'right' },
        { key: 'order_count', label: 'Orders', align: 'right' },
      ],
      rows:
        snapshot.supplier_breakdown.length > 0
          ? snapshot.supplier_breakdown.map(item => ({
              supplier: item.supplier_name,
              outstanding: formatNumber(item.outstanding_quantity),
              order_count: formatNumber(item.supplier_order_count),
            }))
          : [{ supplier: 'No open supplier orders', outstanding: '0', order_count: '0' }],
      footer:
        snapshot.open_purchase_order_count > 0
          ? `Across ${formatNumber(snapshot.open_purchase_order_count)} open purchase orders.`
          : 'No open purchase orders are currently linked to this item.',
    };
  }

  if (intent === 'reserved') {
    return {
      type: 'table',
      title: `Inventory snapshot for ${snapshot.component.internal_code}`,
      description: label,
      metrics: [
        {
          label: 'Reserved',
          value: formatNumber(snapshot.reserved),
        },
        {
          label: 'On hand',
          value: formatNumber(snapshot.on_hand),
        },
        {
          label: 'Available',
          value: formatNumber(snapshot.available),
        },
      ],
      columns: [
        { key: 'order', label: 'Order' },
        { key: 'status', label: 'Status' },
        { key: 'delivery', label: 'Delivery' },
        { key: 'reserved', label: 'Reserved', align: 'right' },
      ],
      rows:
        snapshot.reservation_breakdown.length > 0
          ? snapshot.reservation_breakdown.map(row => ({
              order: row.order_number?.trim() || `Order ${row.order_id}`,
              status: row.status_name?.trim() || 'No status set',
              delivery: row.delivery_date ?? 'No delivery date',
              reserved: formatNumber(row.qty_reserved),
            }))
          : [{ order: 'No reservations', status: '-', delivery: '-', reserved: '0' }],
      footer:
        snapshot.available < 0
          ? 'Reserved quantity currently exceeds on-hand stock.'
          : 'Showing current order reservations for this item.',
    };
  }

  return {
    type: 'table',
    title: `Inventory snapshot for ${snapshot.component.internal_code}`,
    description: label,
    metrics: [
      {
        label: 'On hand',
        value: formatNumber(snapshot.on_hand),
      },
      {
        label: 'Reserved',
        value: formatNumber(snapshot.reserved),
      },
      {
        label: 'Available',
        value: formatNumber(snapshot.available),
      },
      {
        label: 'On order',
        value: formatNumber(snapshot.on_order),
      },
    ],
    columns: [
      { key: 'supplier', label: 'Supplier' },
      { key: 'outstanding', label: 'On order', align: 'right' },
      { key: 'order_count', label: 'Orders', align: 'right' },
    ],
    rows:
      snapshot.supplier_breakdown.length > 0
        ? snapshot.supplier_breakdown.map(item => ({
            supplier: item.supplier_name,
            outstanding: formatNumber(item.outstanding_quantity),
            order_count: formatNumber(item.supplier_order_count),
          }))
        : [{ supplier: 'No open supplier orders', outstanding: '0', order_count: '0' }],
    footer:
      snapshot.component.reorder_level != null && snapshot.component.reorder_level > 0
        ? `Reorder level: ${formatNumber(snapshot.component.reorder_level)}${snapshot.component.location ? ` | Location: ${snapshot.component.location}` : ''}`
        : snapshot.component.location
          ? `Location: ${snapshot.component.location}`
          : 'Showing current supply snapshot for this item.',
  };
}
