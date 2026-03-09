import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistantCard } from '@/lib/assistant/prompt-suggestions';

import {
  buildAssistantComponentClarifyAnswer,
  getRelationRecord,
  resolveAssistantComponent,
  type AssistantComponentLookupResult,
} from '@/lib/assistant/component-resolver';
import { SO_STATUS } from '@/types/purchasing';

type SupplierRelation = {
  name?: string | null;
};

type SupplierComponentRow = {
  supplier_component_id: number;
  supplier_id?: number | null;
  supplier?: SupplierRelation | SupplierRelation[] | null;
};

type SupplierOrderStatusRelation = {
  status_name?: string | null;
};

type SupplierOrderRow = {
  order_id: number;
  supplier_component_id: number;
  order_quantity?: number | string | null;
  total_received?: number | string | null;
  order_date?: string | null;
  purchase_order_id?: number | null;
  q_number?: string | null;
  status_id?: number | null;
  status?: SupplierOrderStatusRelation | SupplierOrderStatusRelation[] | null;
};

type PurchaseOrderRow = {
  purchase_order_id: number;
  q_number?: string | null;
  supplier_id?: number | null;
  supplier?: SupplierRelation | SupplierRelation[] | null;
};

type FollowUpEmailRow = {
  id: number;
  purchase_order_id?: number | null;
  supplier_name?: string | null;
};

type FollowUpResponseRow = {
  follow_up_id: number;
  expected_delivery_date?: string | null;
  status?: string | null;
  responded_at?: string | null;
};

type AssistantPurchasingComponent = {
  component_id: number;
  internal_code: string;
  description: string | null;
};

export type AssistantPurchasingIntent = 'supplier_orders_for_item' | 'next_delivery_for_item';

export type AssistantSupplierOrdersFollowUpSummary = {
  open_supplier_order_count: number;
  follow_up_threshold_days: number;
  older_than_threshold_count: number;
  no_eta_count: number;
  suppliers: Array<{
    supplier_name: string;
    count: number;
  }>;
  lines: Array<{
    supplier_order_id: number;
    purchase_order_id: number | null;
    q_number: string | null;
    supplier_name: string | null;
    status_name: string | null;
    order_date: string | null;
    outstanding_qty: number;
    days_open: number | null;
  }>;
};

export type AssistantLateSupplierOrdersSummary =
  | {
      kind: 'summary';
      late_supplier_order_count: number;
      lines: Array<{
        supplier_order_id: number;
        purchase_order_id: number | null;
        q_number: string | null;
        supplier_name: string | null;
        expected_delivery_date: string;
        outstanding_qty: number;
        days_late: number;
      }>;
    }
  | {
      kind: 'no_late_orders';
      tracked_supplier_order_count: number;
    }
  | {
      kind: 'no_eta_data';
      open_supplier_order_count: number;
    };

export type AssistantItemSupplierOrdersSummary =
  | {
      kind: 'summary';
      component: AssistantPurchasingComponent;
      total_on_order: number;
      total_received_on_open_orders: number;
      open_supplier_order_count: number;
      open_purchase_order_count: number;
      orders: Array<{
        supplier_order_id: number;
        purchase_order_id: number | null;
        q_number: string | null;
        supplier_name: string | null;
        status_name: string | null;
        order_date: string | null;
        ordered_qty: number;
        received_qty: number;
        outstanding_qty: number;
      }>;
    }
  | Exclude<AssistantComponentLookupResult, { kind: 'resolved' }>;

export type AssistantNextDeliverySummary =
  | {
      kind: 'summary';
      component: AssistantPurchasingComponent;
      next_delivery_date: string;
      supplier_name: string | null;
      q_number: string | null;
      purchase_order_id: number | null;
      eta_count: number;
      open_supplier_order_count: number;
      total_on_order: number;
      eta_options: Array<{
        expected_delivery_date: string;
        supplier_name: string | null;
        q_number: string | null;
        purchase_order_id: number | null;
      }>;
    }
  | {
      kind: 'no_open_orders';
      component: AssistantPurchasingComponent;
    }
  | {
      kind: 'no_eta';
      component: AssistantPurchasingComponent;
      total_on_order: number;
      open_supplier_order_count: number;
      orders: Array<{
        supplier_order_id: number;
        purchase_order_id: number | null;
        q_number: string | null;
        supplier_name: string | null;
        outstanding_qty: number;
      }>;
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

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function differenceInDaysFromDateOnly(earlier: string, later: string) {
  const earlierDate = parseDateOnly(earlier);
  const laterDate = parseDateOnly(later);
  return Math.floor((laterDate.getTime() - earlierDate.getTime()) / 86_400_000);
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

type GlobalSupplierOrderLine = {
  supplier_order_id: number;
  supplier_component_id: number;
  purchase_order_id: number | null;
  q_number: string | null;
  supplier_name: string | null;
  status_name: string | null;
  order_date: string | null;
  outstanding_qty: number;
};

function formatDateForAnswer(value: string) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parseDateOnly(value));
}

async function loadOpenSupplierOrdersForComponent(
  supabase: SupabaseClient,
  componentRef: string
): Promise<AssistantItemSupplierOrdersSummary> {
  const resolved = await resolveAssistantComponent(supabase, componentRef);
  if (resolved.kind !== 'resolved') {
    return resolved;
  }

  const component = resolved.component;
  const componentLabel = {
    component_id: component.component_id,
    internal_code: component.internal_code ?? `Component ${component.component_id}`,
    description: component.description ?? null,
  };

  const { data: supplierComponentRows, error: supplierComponentError } = await supabase
    .from('suppliercomponents')
    .select('supplier_component_id, supplier_id, supplier:suppliers(name)')
    .eq('component_id', component.component_id);

  if (supplierComponentError) {
    throw supplierComponentError;
  }

  const supplierComponents = (supplierComponentRows ?? []) as SupplierComponentRow[];
  const supplierComponentIds = supplierComponents.map(row => row.supplier_component_id);

  if (supplierComponentIds.length === 0) {
    return {
      kind: 'summary',
      component: componentLabel,
      total_on_order: 0,
      total_received_on_open_orders: 0,
      open_supplier_order_count: 0,
      open_purchase_order_count: 0,
      orders: [],
    };
  }

  const supplierNameBySupplierComponentId = new Map<number, string | null>();
  for (const row of supplierComponents) {
    const supplier = getRelationRecord(row.supplier);
    supplierNameBySupplierComponentId.set(
      row.supplier_component_id,
      supplier?.name?.trim() || null
    );
  }

  const { data: supplierOrderRows, error: supplierOrderError } = await supabase
    .from('supplier_orders')
    .select(
      'order_id, supplier_component_id, order_quantity, total_received, order_date, purchase_order_id, q_number, status_id, status:supplier_order_statuses(status_name)'
    )
    .in('supplier_component_id', supplierComponentIds)
    .in('status_id', [
      SO_STATUS.OPEN,
      SO_STATUS.IN_PROGRESS,
      SO_STATUS.PENDING_APPROVAL,
      SO_STATUS.APPROVED,
      SO_STATUS.PARTIALLY_RECEIVED,
    ])
    .order('order_date', { ascending: false, nullsFirst: false })
    .order('order_id', { ascending: false });

  if (supplierOrderError) {
    throw supplierOrderError;
  }

  const supplierOrders = ((supplierOrderRows ?? []) as SupplierOrderRow[])
    .map(row => {
      const orderedQty = toNumber(row.order_quantity);
      const receivedQty = toNumber(row.total_received);
      const outstandingQty = Math.max(orderedQty - receivedQty, 0);
      const status = getRelationRecord(row.status);
      return {
        supplier_order_id: row.order_id,
        supplier_component_id: row.supplier_component_id,
        purchase_order_id: row.purchase_order_id ?? null,
        q_number: row.q_number?.trim() || null,
        supplier_name:
          supplierNameBySupplierComponentId.get(row.supplier_component_id) ?? null,
        status_name: status?.status_name?.trim() || null,
        order_date: row.order_date?.slice(0, 10) || null,
        ordered_qty: orderedQty,
        received_qty: receivedQty,
        outstanding_qty: outstandingQty,
      };
    })
    .filter(row => row.outstanding_qty > 0);

  const purchaseOrderIds = Array.from(
    new Set(
      supplierOrders
        .map(row => row.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );

  const purchaseOrderMeta = new Map<
    number,
    { q_number: string | null; supplier_name: string | null }
  >();
  if (purchaseOrderIds.length > 0) {
    const { data: purchaseOrderRows, error: purchaseOrderError } = await supabase
      .from('purchase_orders')
      .select('purchase_order_id, q_number, supplier_id, supplier:suppliers(name)')
      .in('purchase_order_id', purchaseOrderIds);

    if (purchaseOrderError) {
      throw purchaseOrderError;
    }

    for (const row of (purchaseOrderRows ?? []) as PurchaseOrderRow[]) {
      const supplier = getRelationRecord(row.supplier);
      purchaseOrderMeta.set(row.purchase_order_id, {
        q_number: row.q_number?.trim() || null,
        supplier_name: supplier?.name?.trim() || null,
      });
    }
  }

  const normalizedOrders = supplierOrders.map(order => {
    const purchaseOrder = order.purchase_order_id
      ? purchaseOrderMeta.get(order.purchase_order_id)
      : null;
    return {
      ...order,
      q_number: purchaseOrder?.q_number || order.q_number || null,
      supplier_name: purchaseOrder?.supplier_name || order.supplier_name || null,
    };
  });

  return {
    kind: 'summary',
    component: componentLabel,
    total_on_order: normalizedOrders.reduce((sum, row) => sum + row.outstanding_qty, 0),
    total_received_on_open_orders: normalizedOrders.reduce((sum, row) => sum + row.received_qty, 0),
    open_supplier_order_count: normalizedOrders.length,
    open_purchase_order_count: new Set(
      normalizedOrders
        .map(row => row.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ).size,
    orders: normalizedOrders,
  };
}

export async function getItemSupplierOrdersSummary(
  supabase: SupabaseClient,
  componentRef: string
): Promise<AssistantItemSupplierOrdersSummary> {
  return loadOpenSupplierOrdersForComponent(supabase, componentRef);
}

async function loadOpenSupplierOrderLines(
  supabase: SupabaseClient
): Promise<GlobalSupplierOrderLine[]> {
  const { data: supplierOrderRows, error: supplierOrderError } = await supabase
    .from('supplier_orders')
    .select(
      'order_id, supplier_component_id, order_quantity, total_received, order_date, purchase_order_id, q_number, status_id, status:supplier_order_statuses(status_name)'
    )
    .in('status_id', [
      SO_STATUS.OPEN,
      SO_STATUS.IN_PROGRESS,
      SO_STATUS.PENDING_APPROVAL,
      SO_STATUS.APPROVED,
      SO_STATUS.PARTIALLY_RECEIVED,
    ])
    .order('order_date', { ascending: true, nullsFirst: false })
    .order('order_id', { ascending: true });

  if (supplierOrderError) {
    throw supplierOrderError;
  }

  const supplierOrders = ((supplierOrderRows ?? []) as SupplierOrderRow[])
    .map(row => ({
      supplier_order_id: row.order_id,
      supplier_component_id: row.supplier_component_id,
      purchase_order_id: row.purchase_order_id ?? null,
      q_number: row.q_number?.trim() || null,
      status_name: getRelationRecord(row.status)?.status_name?.trim() || null,
      order_date: row.order_date?.slice(0, 10) || null,
      outstanding_qty: Math.max(toNumber(row.order_quantity) - toNumber(row.total_received), 0),
    }))
    .filter(row => row.outstanding_qty > 0);

  const supplierComponentIds = Array.from(
    new Set(supplierOrders.map(row => row.supplier_component_id))
  );
  const supplierNameBySupplierComponentId = new Map<number, string | null>();

  if (supplierComponentIds.length > 0) {
    const { data: supplierComponentRows, error: supplierComponentError } = await supabase
      .from('suppliercomponents')
      .select('supplier_component_id, supplier:suppliers(name)')
      .in('supplier_component_id', supplierComponentIds);

    if (supplierComponentError) {
      throw supplierComponentError;
    }

    for (const row of (supplierComponentRows ?? []) as SupplierComponentRow[]) {
      supplierNameBySupplierComponentId.set(
        row.supplier_component_id,
        getRelationRecord(row.supplier)?.name?.trim() || null
      );
    }
  }

  const purchaseOrderIds = Array.from(
    new Set(
      supplierOrders
        .map(row => row.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );
  const purchaseOrderMeta = new Map<number, { q_number: string | null; supplier_name: string | null }>();

  if (purchaseOrderIds.length > 0) {
    const { data: purchaseOrderRows, error: purchaseOrderError } = await supabase
      .from('purchase_orders')
      .select('purchase_order_id, q_number, supplier:suppliers(name)')
      .in('purchase_order_id', purchaseOrderIds);

    if (purchaseOrderError) {
      throw purchaseOrderError;
    }

    for (const row of (purchaseOrderRows ?? []) as PurchaseOrderRow[]) {
      purchaseOrderMeta.set(row.purchase_order_id, {
        q_number: row.q_number?.trim() || null,
        supplier_name: getRelationRecord(row.supplier)?.name?.trim() || null,
      });
    }
  }

  return supplierOrders.map(order => {
    const purchaseOrder = order.purchase_order_id
      ? purchaseOrderMeta.get(order.purchase_order_id)
      : null;
    return {
      supplier_order_id: order.supplier_order_id,
      supplier_component_id: order.supplier_component_id,
      purchase_order_id: order.purchase_order_id,
      q_number: purchaseOrder?.q_number || order.q_number || null,
      supplier_name:
        purchaseOrder?.supplier_name ||
        supplierNameBySupplierComponentId.get(order.supplier_component_id) ||
        null,
      status_name: order.status_name,
      order_date: order.order_date,
      outstanding_qty: order.outstanding_qty,
    };
  });
}

export async function getItemNextDeliverySummary(
  supabase: SupabaseClient,
  componentRef: string
): Promise<AssistantNextDeliverySummary> {
  const supplierOrdersSummary = await loadOpenSupplierOrdersForComponent(supabase, componentRef);
  if (supplierOrdersSummary.kind !== 'summary') {
    return supplierOrdersSummary;
  }

  if (supplierOrdersSummary.orders.length === 0) {
    return {
      kind: 'no_open_orders',
      component: supplierOrdersSummary.component,
    };
  }

  const purchaseOrderIds = Array.from(
    new Set(
      supplierOrdersSummary.orders
        .map(order => order.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );

  if (purchaseOrderIds.length === 0) {
    return {
      kind: 'no_eta',
      component: supplierOrdersSummary.component,
      total_on_order: supplierOrdersSummary.total_on_order,
      open_supplier_order_count: supplierOrdersSummary.open_supplier_order_count,
      orders: supplierOrdersSummary.orders.slice(0, 3).map(order => ({
        supplier_order_id: order.supplier_order_id,
        purchase_order_id: order.purchase_order_id,
        q_number: order.q_number,
        supplier_name: order.supplier_name,
        outstanding_qty: order.outstanding_qty,
      })),
    };
  }

  const { data: followUpEmailRows, error: followUpEmailError } = await supabase
    .from('component_follow_up_emails')
    .select('id, purchase_order_id, supplier_name')
    .eq('component_id', supplierOrdersSummary.component.component_id)
    .in('purchase_order_id', purchaseOrderIds);

  if (followUpEmailError) {
    throw followUpEmailError;
  }

  const followUpEmails = (followUpEmailRows ?? []) as FollowUpEmailRow[];
  const followUpIds = followUpEmails.map(row => row.id);
  if (followUpIds.length === 0) {
    return {
      kind: 'no_eta',
      component: supplierOrdersSummary.component,
      total_on_order: supplierOrdersSummary.total_on_order,
      open_supplier_order_count: supplierOrdersSummary.open_supplier_order_count,
      orders: supplierOrdersSummary.orders.slice(0, 3).map(order => ({
        supplier_order_id: order.supplier_order_id,
        purchase_order_id: order.purchase_order_id,
        q_number: order.q_number,
        supplier_name: order.supplier_name,
        outstanding_qty: order.outstanding_qty,
      })),
    };
  }

  const { data: responseRows, error: responseError } = await supabase
    .from('supplier_follow_up_responses')
    .select('follow_up_id, expected_delivery_date, status, responded_at')
    .in('follow_up_id', followUpIds)
    .not('expected_delivery_date', 'is', null);

  if (responseError) {
    throw responseError;
  }

  const followUpById = new Map<number, FollowUpEmailRow>();
  for (const row of followUpEmails) {
    followUpById.set(row.id, row);
  }

  const qNumberByPurchaseOrderId = new Map<number, string | null>();
  for (const order of supplierOrdersSummary.orders) {
    if (order.purchase_order_id != null && !qNumberByPurchaseOrderId.has(order.purchase_order_id)) {
      qNumberByPurchaseOrderId.set(order.purchase_order_id, order.q_number);
    }
  }

  const etaOptions = Array.from(
    new Map(
      ((responseRows ?? []) as FollowUpResponseRow[])
        .map(row => {
          const followUp = followUpById.get(row.follow_up_id);
          const purchaseOrderId = followUp?.purchase_order_id ?? null;
          const expectedDeliveryDate = row.expected_delivery_date?.slice(0, 10) ?? null;
          if (!expectedDeliveryDate) {
            return null;
          }

          const supplierName =
            followUp?.supplier_name?.trim() ||
            supplierOrdersSummary.orders.find(order => order.purchase_order_id === purchaseOrderId)
              ?.supplier_name ||
            null;
          const qNumber =
            (purchaseOrderId != null ? qNumberByPurchaseOrderId.get(purchaseOrderId) : null) ?? null;
          const key = `${purchaseOrderId ?? 'no-po'}:${expectedDeliveryDate}:${supplierName ?? 'unknown'}`;

          return [
            key,
            {
              expected_delivery_date: expectedDeliveryDate,
              supplier_name: supplierName,
              q_number: qNumber,
              purchase_order_id: purchaseOrderId,
            },
          ] as const;
        })
        .filter(
          (
            row
          ): row is readonly [
            string,
            {
              expected_delivery_date: string;
              supplier_name: string | null;
              q_number: string | null;
              purchase_order_id: number | null;
            },
          ] => row != null
        )
    ).values()
  ).sort((a, b) => a.expected_delivery_date.localeCompare(b.expected_delivery_date));

  if (etaOptions.length === 0) {
    return {
      kind: 'no_eta',
      component: supplierOrdersSummary.component,
      total_on_order: supplierOrdersSummary.total_on_order,
      open_supplier_order_count: supplierOrdersSummary.open_supplier_order_count,
      orders: supplierOrdersSummary.orders.slice(0, 3).map(order => ({
        supplier_order_id: order.supplier_order_id,
        purchase_order_id: order.purchase_order_id,
        q_number: order.q_number,
        supplier_name: order.supplier_name,
        outstanding_qty: order.outstanding_qty,
      })),
    };
  }

  const [nextEta] = etaOptions;
  return {
    kind: 'summary',
    component: supplierOrdersSummary.component,
    next_delivery_date: nextEta.expected_delivery_date,
    supplier_name: nextEta.supplier_name,
    q_number: nextEta.q_number,
    purchase_order_id: nextEta.purchase_order_id,
    eta_count: etaOptions.length,
    open_supplier_order_count: supplierOrdersSummary.open_supplier_order_count,
    total_on_order: supplierOrdersSummary.total_on_order,
    eta_options: etaOptions.slice(0, 5),
  };
}

export async function getSupplierOrdersFollowUpSummary(
  supabase: SupabaseClient,
  followUpThresholdDays = 14
): Promise<AssistantSupplierOrdersFollowUpSummary> {
  const today = getCurrentDateInZone();
  const thresholdDate = new Date(parseDateOnly(today));
  thresholdDate.setUTCDate(thresholdDate.getUTCDate() - followUpThresholdDays);
  const thresholdDateText = formatDateOnly(thresholdDate);

  const openLines = await loadOpenSupplierOrderLines(supabase);

  const purchaseOrderIds = Array.from(
    new Set(
      openLines
        .map(line => line.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );

  let linesWithEta = new Set<number>();
  if (purchaseOrderIds.length > 0) {
    const { data: followUpEmailRows, error: followUpEmailError } = await supabase
      .from('component_follow_up_emails')
      .select('id, purchase_order_id')
      .in('purchase_order_id', purchaseOrderIds);

    if (followUpEmailError) {
      throw followUpEmailError;
    }

    const followUpRows = (followUpEmailRows ?? []) as FollowUpEmailRow[];
    const followUpIds = followUpRows.map(row => row.id);
    const purchaseOrderIdByFollowUpId = new Map<number, number>();
    for (const row of followUpRows) {
      if (row.purchase_order_id != null) {
        purchaseOrderIdByFollowUpId.set(row.id, row.purchase_order_id);
      }
    }

    if (followUpIds.length > 0) {
      const { data: responseRows, error: responseError } = await supabase
        .from('supplier_follow_up_responses')
        .select('follow_up_id, expected_delivery_date')
        .in('follow_up_id', followUpIds)
        .not('expected_delivery_date', 'is', null);

      if (responseError) {
        throw responseError;
      }

      const purchaseOrdersWithEta = new Set<number>();
      for (const row of (responseRows ?? []) as FollowUpResponseRow[]) {
        const purchaseOrderId = purchaseOrderIdByFollowUpId.get(row.follow_up_id);
        if (purchaseOrderId != null) {
          purchaseOrdersWithEta.add(purchaseOrderId);
        }
      }

      linesWithEta = new Set(
        openLines
          .filter(line => line.purchase_order_id != null && purchaseOrdersWithEta.has(line.purchase_order_id))
          .map(line => line.supplier_order_id)
      );
    }
  }

  const flaggedLines = openLines
    .map(line => ({
      ...line,
      days_open: line.order_date ? differenceInDaysFromDateOnly(line.order_date, today) : null,
    }))
    .filter(
      line =>
        (line.order_date != null && line.order_date <= thresholdDateText) ||
        !linesWithEta.has(line.supplier_order_id)
    )
    .sort((a, b) => (b.days_open ?? -1) - (a.days_open ?? -1));

  const supplierCounts = new Map<string, number>();
  for (const line of flaggedLines) {
    const supplierName = line.supplier_name?.trim() || 'Unknown supplier';
    supplierCounts.set(supplierName, (supplierCounts.get(supplierName) ?? 0) + 1);
  }

  return {
    open_supplier_order_count: openLines.length,
    follow_up_threshold_days: followUpThresholdDays,
    older_than_threshold_count: openLines.filter(
      line => line.order_date != null && line.order_date <= thresholdDateText
    ).length,
    no_eta_count: openLines.filter(line => !linesWithEta.has(line.supplier_order_id)).length,
    suppliers: Array.from(supplierCounts.entries())
      .map(([supplier_name, count]) => ({ supplier_name, count }))
      .sort((a, b) => b.count - a.count),
    lines: flaggedLines.slice(0, 8).map(line => ({
      supplier_order_id: line.supplier_order_id,
      purchase_order_id: line.purchase_order_id,
      q_number: line.q_number,
      supplier_name: line.supplier_name,
      status_name: line.status_name,
      order_date: line.order_date,
      outstanding_qty: line.outstanding_qty,
      days_open: line.days_open,
    })),
  };
}

export async function getLateSupplierOrdersSummary(
  supabase: SupabaseClient
): Promise<AssistantLateSupplierOrdersSummary> {
  const today = getCurrentDateInZone();
  const openLines = await loadOpenSupplierOrderLines(supabase);

  const purchaseOrderIds = Array.from(
    new Set(
      openLines
        .map(line => line.purchase_order_id)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    )
  );

  if (purchaseOrderIds.length === 0) {
    return {
      kind: 'no_eta_data',
      open_supplier_order_count: openLines.length,
    };
  }

  const { data: followUpEmailRows, error: followUpEmailError } = await supabase
    .from('component_follow_up_emails')
    .select('id, purchase_order_id')
    .in('purchase_order_id', purchaseOrderIds);

  if (followUpEmailError) {
    throw followUpEmailError;
  }

  const followUpRows = (followUpEmailRows ?? []) as FollowUpEmailRow[];
  const followUpIds = followUpRows.map(row => row.id);
  if (followUpIds.length === 0) {
    return {
      kind: 'no_eta_data',
      open_supplier_order_count: openLines.length,
    };
  }

  const purchaseOrderIdByFollowUpId = new Map<number, number>();
  for (const row of followUpRows) {
    if (row.purchase_order_id != null) {
      purchaseOrderIdByFollowUpId.set(row.id, row.purchase_order_id);
    }
  }

  const { data: responseRows, error: responseError } = await supabase
    .from('supplier_follow_up_responses')
    .select('follow_up_id, expected_delivery_date')
    .in('follow_up_id', followUpIds)
    .not('expected_delivery_date', 'is', null);

  if (responseError) {
    throw responseError;
  }

  const etaByPurchaseOrderId = new Map<number, string>();
  for (const row of (responseRows ?? []) as FollowUpResponseRow[]) {
    const purchaseOrderId = purchaseOrderIdByFollowUpId.get(row.follow_up_id);
    const expectedDeliveryDate = row.expected_delivery_date?.slice(0, 10) ?? null;
    if (purchaseOrderId == null || !expectedDeliveryDate) {
      continue;
    }

    const existing = etaByPurchaseOrderId.get(purchaseOrderId);
    if (!existing || expectedDeliveryDate < existing) {
      etaByPurchaseOrderId.set(purchaseOrderId, expectedDeliveryDate);
    }
  }

  if (etaByPurchaseOrderId.size === 0) {
    return {
      kind: 'no_eta_data',
      open_supplier_order_count: openLines.length,
    };
  }

  const lateLines = openLines
    .map(line => {
      const expectedDeliveryDate =
        line.purchase_order_id != null ? etaByPurchaseOrderId.get(line.purchase_order_id) : null;
      if (!expectedDeliveryDate || expectedDeliveryDate >= today) {
        return null;
      }

      return {
        supplier_order_id: line.supplier_order_id,
        purchase_order_id: line.purchase_order_id,
        q_number: line.q_number,
        supplier_name: line.supplier_name,
        expected_delivery_date: expectedDeliveryDate,
        outstanding_qty: line.outstanding_qty,
        days_late: differenceInDaysFromDateOnly(expectedDeliveryDate, today),
      };
    })
    .filter(
      (
        line
      ): line is {
        supplier_order_id: number;
        purchase_order_id: number | null;
        q_number: string | null;
        supplier_name: string | null;
        expected_delivery_date: string;
        outstanding_qty: number;
        days_late: number;
      } => line != null
    )
    .sort((a, b) => b.days_late - a.days_late);

  if (lateLines.length === 0) {
    return {
      kind: 'no_late_orders',
      tracked_supplier_order_count: openLines.filter(
        line => line.purchase_order_id != null && etaByPurchaseOrderId.has(line.purchase_order_id)
      ).length,
    };
  }

  return {
    kind: 'summary',
    late_supplier_order_count: lateLines.length,
    lines: lateLines.slice(0, 8),
  };
}

export function detectPurchasingIntent(
  message: string
): AssistantPurchasingIntent | 'late_supplier_orders' | 'supplier_orders_follow_up' | null {
  const normalized = message.toLowerCase();

  if (
    /\b(supplier orders?|purchase orders?|supplier lines?)\b/.test(normalized) &&
    /\b(need follow-up|needs follow-up|follow up|follow-up|chase|chasing)\b/.test(normalized)
  ) {
    return 'supplier_orders_follow_up';
  }

  if (
    /\b(which supplier orders are late|late supplier orders|overdue supplier orders|which purchase orders are late)\b/.test(
      normalized
    )
  ) {
    return 'late_supplier_orders';
  }

  if (
    /\b(next delivery|expected delivery|eta|arriving|arrival date|when will .* arrive|when is .* due)\b/.test(
      normalized
    )
  ) {
    return 'next_delivery_for_item';
  }

  if (
    /\b(supplier orders?|purchase orders?|open po|open purchase orders?)\b/.test(normalized) &&
    /\b(which|what|show|list|include|includes|for)\b/.test(normalized)
  ) {
    return 'supplier_orders_for_item';
  }

  return null;
}

export function extractPurchasingComponentReference(message: string) {
  let value = message
    .replace(/[?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  value = value.replace(/^(how much|how many|what(?:'s| is)|which|show|list|tell me|please|when)\s+/i, '');
  value = value.replace(/\b(do we have|is there|are there)\b/gi, ' ');
  value = value.replace(
    /\b(supplier order|supplier orders|purchase order|purchase orders|open po|open pos|open purchase orders|include|includes|next delivery|expected delivery|delivery|deliveries|eta|arriving|arrival date|incoming|due)\b/gi,
    ' '
  );
  value = value.replace(/\b(right now|currently|today|for this item|for item|for component)\b/gi, ' ');
  value = value.replace(/\b(is|are|was|were|will)\b/gi, ' ');
  value = value.replace(/^(of|for|the|a|an)\s+/i, '');
  value = value.replace(/\b(of|for|the|a|an)\s*$/i, '');
  value = value.replace(/\s+/g, ' ').trim();

  return value;
}

function formatComponentLabel(component: AssistantPurchasingComponent) {
  return component.description
    ? `${component.internal_code} - ${component.description}`
    : component.internal_code;
}

export function buildSupplierOrdersAnswer(summary: AssistantItemSupplierOrdersSummary) {
  if (summary.kind === 'ambiguous') {
    return buildAssistantComponentClarifyAnswer(summary.component_ref, summary.candidates);
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find a component matching "${summary.component_ref}" in Unity.`;
  }

  const lines = [`Item: ${formatComponentLabel(summary.component)}`];

  lines.push(`On order: ${formatNumber(summary.total_on_order)}`);
  lines.push(`Received already on open supplier lines: ${formatNumber(summary.total_received_on_open_orders)}`);
  lines.push(`Open supplier orders: ${formatNumber(summary.open_supplier_order_count)}`);
  lines.push(`Open purchase orders: ${formatNumber(summary.open_purchase_order_count)}`);

  if (summary.orders.length === 0) {
    lines.push('No open supplier orders currently include this item.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Open supplier lines:');
  for (const order of summary.orders.slice(0, 5)) {
    const poLabel = order.q_number?.trim() || (order.purchase_order_id ? `PO ${order.purchase_order_id}` : 'No PO linked');
    const supplierLabel = order.supplier_name?.trim() || 'Unknown supplier';
    const statusLabel = order.status_name?.trim() || 'Unknown status';
    const dateLabel = order.order_date ? formatDateForAnswer(order.order_date) : 'No order date';
    lines.push(
      `- ${poLabel} | ${supplierLabel} | outstanding ${formatNumber(order.outstanding_qty)} of ${formatNumber(order.ordered_qty)} | ${statusLabel} | ordered ${dateLabel}`
    );
  }

  return lines.join('\n');
}

export function buildSupplierOrdersCard(summary: AssistantItemSupplierOrdersSummary): AssistantCard | undefined {
  if (summary.kind !== 'summary') {
    return undefined;
  }

  return {
    type: 'table',
    title: `Supplier orders for ${summary.component.internal_code}`,
    description: summary.component.description?.trim()
      ? summary.component.description.trim()
      : 'Open supplier lines that currently include this component.',
    metrics: [
      {
        label: 'On order',
        value: formatNumber(summary.total_on_order),
      },
      {
        label: 'Open supplier orders',
        value: formatNumber(summary.open_supplier_order_count),
      },
      {
        label: 'Open POs',
        value: formatNumber(summary.open_purchase_order_count),
      },
    ],
    columns: [
      { key: 'po', label: 'Supplier order' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'status', label: 'Status' },
      { key: 'ordered', label: 'Ordered' },
      { key: 'outstanding', label: 'Outstanding', align: 'right' },
    ],
    rows: summary.orders.map(order => ({
      po:
        order.q_number?.trim() ||
        (order.purchase_order_id ? `PO ${order.purchase_order_id}` : 'No PO linked'),
      supplier: order.supplier_name?.trim() || 'Unknown supplier',
      status: order.status_name?.trim() || 'Unknown status',
      ordered: order.order_date ? formatDateForAnswer(order.order_date) : 'No order date',
      outstanding: `${formatNumber(order.outstanding_qty)} / ${formatNumber(order.ordered_qty)}`,
    })),
    footer:
      summary.orders.length === 0
        ? 'No open supplier orders currently include this item.'
        : summary.open_supplier_order_count > summary.orders.length
          ? 'Only the newest supplier lines are shown here.'
          : 'All open supplier lines for this item are shown here.',
  };
}

export function buildNextDeliveryAnswer(summary: AssistantNextDeliverySummary) {
  if (summary.kind === 'ambiguous') {
    return buildAssistantComponentClarifyAnswer(summary.component_ref, summary.candidates);
  }

  if (summary.kind === 'not_found') {
    return `I don't know. I couldn't find a component matching "${summary.component_ref}" in Unity.`;
  }

  if (summary.kind === 'no_open_orders') {
    return `I don't know because ${formatComponentLabel(summary.component)} has no open supplier orders right now.`;
  }

  if (summary.kind === 'no_eta') {
    const lines = [
      `Item: ${formatComponentLabel(summary.component)}`,
      'I don\'t know the next delivery date because there is no reliable expected delivery date recorded for the current open supplier orders.',
      `On order: ${formatNumber(summary.total_on_order)}`,
      `Open supplier orders: ${formatNumber(summary.open_supplier_order_count)}`,
    ];

    if (summary.orders.length > 0) {
      lines.push('');
      lines.push('Current open supplier lines:');
      for (const order of summary.orders) {
        const poLabel =
          order.q_number?.trim() ||
          (order.purchase_order_id ? `PO ${order.purchase_order_id}` : 'No PO linked');
        const supplierLabel = order.supplier_name?.trim() || 'Unknown supplier';
        lines.push(
          `- ${poLabel} | ${supplierLabel} | outstanding ${formatNumber(order.outstanding_qty)}`
        );
      }
    }

    return lines.join('\n');
  }

  const lines = [
    `Item: ${formatComponentLabel(summary.component)}`,
    `Next expected delivery: ${formatDateForAnswer(summary.next_delivery_date)}`,
    `Supplier: ${summary.supplier_name?.trim() || 'Unknown supplier'}`,
    `Purchase order: ${
      summary.q_number?.trim() ||
      (summary.purchase_order_id ? `PO ${summary.purchase_order_id}` : 'No PO linked')
    }`,
    `Open supplier orders: ${formatNumber(summary.open_supplier_order_count)}`,
    `On order: ${formatNumber(summary.total_on_order)}`,
  ];

  if (summary.eta_options.length > 1) {
    lines.push('');
    lines.push('Other recorded ETAs:');
    for (const option of summary.eta_options.slice(1, 5)) {
      lines.push(
        `- ${formatDateForAnswer(option.expected_delivery_date)} | ${
          option.supplier_name?.trim() || 'Unknown supplier'
        } | ${
          option.q_number?.trim() ||
          (option.purchase_order_id ? `PO ${option.purchase_order_id}` : 'No PO linked')
        }`
      );
    }
  }

  return lines.join('\n');
}

export function buildNextDeliveryCard(summary: AssistantNextDeliverySummary): AssistantCard | undefined {
  if (summary.kind === 'ambiguous' || summary.kind === 'not_found') {
    return undefined;
  }

  if (summary.kind === 'no_open_orders') {
    return {
      type: 'table',
      title: `Next delivery for ${summary.component.internal_code}`,
      description: summary.component.description?.trim() || 'No open supplier orders for this item.',
      metrics: [
        {
          label: 'Open supplier orders',
          value: '0',
        },
      ],
      columns: [
        { key: 'status', label: 'Status' },
      ],
      rows: [{ status: 'No open supplier orders right now' }],
      footer: 'There is no next delivery to show because no supplier orders are currently open for this item.',
    };
  }

  if (summary.kind === 'no_eta') {
    return {
      type: 'table',
      title: `Next delivery for ${summary.component.internal_code}`,
      description: summary.component.description?.trim() || 'Open supplier lines for this item.',
      metrics: [
        {
          label: 'On order',
          value: formatNumber(summary.total_on_order),
        },
        {
          label: 'Open supplier orders',
          value: formatNumber(summary.open_supplier_order_count),
        },
      ],
      columns: [
        { key: 'po', label: 'Supplier order' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'outstanding', label: 'Outstanding', align: 'right' },
      ],
      rows: summary.orders.map(order => ({
        po:
          order.q_number?.trim() ||
          (order.purchase_order_id ? `PO ${order.purchase_order_id}` : 'No PO linked'),
        supplier: order.supplier_name?.trim() || 'Unknown supplier',
        outstanding: formatNumber(order.outstanding_qty),
      })),
      footer: 'No verified ETA is currently recorded for these open supplier orders.',
    };
  }

  return {
    type: 'table',
    title: `Next delivery for ${summary.component.internal_code}`,
    description: summary.component.description?.trim() || 'Recorded ETAs for this item.',
    metrics: [
      {
        label: 'Next ETA',
        value: formatDateForAnswer(summary.next_delivery_date),
      },
      {
        label: 'On order',
        value: formatNumber(summary.total_on_order),
      },
      {
        label: 'Open supplier orders',
        value: formatNumber(summary.open_supplier_order_count),
      },
    ],
    columns: [
      { key: 'eta', label: 'ETA' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'po', label: 'Supplier order' },
    ],
    rows: summary.eta_options.map(option => ({
      eta: formatDateForAnswer(option.expected_delivery_date),
      supplier: option.supplier_name?.trim() || 'Unknown supplier',
      po:
        option.q_number?.trim() ||
        (option.purchase_order_id ? `PO ${option.purchase_order_id}` : 'No PO linked'),
    })),
    footer:
      summary.eta_options.length > 1
        ? 'Additional recorded ETAs are shown below the next expected delivery.'
        : 'Showing the only verified ETA currently recorded for this item.',
  };
}

export function buildSupplierOrdersFollowUpAnswer(summary: AssistantSupplierOrdersFollowUpSummary) {
  const lines = [
    `Open supplier orders needing follow-up: ${formatNumber(summary.lines.length)}`,
    `Open supplier lines checked: ${formatNumber(summary.open_supplier_order_count)}`,
    `Older than ${formatNumber(summary.follow_up_threshold_days)} days: ${formatNumber(summary.older_than_threshold_count)}`,
    `Open lines without verified ETA: ${formatNumber(summary.no_eta_count)}`,
  ];

  if (summary.suppliers.length > 0) {
    lines.push(
      `Suppliers to chase first: ${summary.suppliers
        .slice(0, 3)
        .map(item => `${item.supplier_name} (${formatNumber(item.count)})`)
        .join(', ')}`
    );
  }

  if (summary.lines.length > 0) {
    lines.push('');
    lines.push('Oldest / least-tracked open supplier lines:');
    for (const line of summary.lines.slice(0, 5)) {
      const poLabel =
        line.q_number?.trim() ||
        (line.purchase_order_id ? `PO ${line.purchase_order_id}` : 'No PO linked');
      const supplierLabel = line.supplier_name?.trim() || 'Unknown supplier';
      const dateLabel = line.order_date ? formatDateForAnswer(line.order_date) : 'No order date';
      const daysLabel =
        line.days_open == null ? 'unknown age' : `${formatNumber(line.days_open)} days open`;
      lines.push(
        `- ${poLabel} | ${supplierLabel} | outstanding ${formatNumber(line.outstanding_qty)} | ${daysLabel} | ordered ${dateLabel}`
      );
    }
  } else {
    lines.push('No open supplier orders currently meet the follow-up criteria.');
  }

  return lines.join('\n');
}

export function buildSupplierOrdersFollowUpCard(
  summary: AssistantSupplierOrdersFollowUpSummary
): AssistantCard {
  return {
    type: 'table',
    title: 'Supplier orders needing follow-up',
    description: `Open supplier lines older than ${formatNumber(summary.follow_up_threshold_days)} days or missing a verified ETA.`,
    metrics: [
      {
        label: 'Flagged lines',
        value: formatNumber(summary.lines.length),
      },
      {
        label: 'No ETA',
        value: formatNumber(summary.no_eta_count),
      },
      {
        label: `>${summary.follow_up_threshold_days} days`,
        value: formatNumber(summary.older_than_threshold_count),
      },
    ],
    columns: [
      { key: 'po', label: 'Supplier order' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'ordered', label: 'Ordered' },
      { key: 'days_open', label: 'Days open', align: 'right' },
      { key: 'outstanding', label: 'Outstanding', align: 'right' },
    ],
    rows: summary.lines.map(line => ({
      po:
        line.q_number?.trim() ||
        (line.purchase_order_id ? `PO ${line.purchase_order_id}` : 'No PO linked'),
      supplier: line.supplier_name?.trim() || 'Unknown supplier',
      ordered: line.order_date ? formatDateForAnswer(line.order_date) : 'No order date',
      days_open: line.days_open == null ? 'Unknown' : formatNumber(line.days_open),
      outstanding: formatNumber(line.outstanding_qty),
    })),
    footer:
      summary.lines.length === 0
        ? 'No open supplier lines currently meet the follow-up criteria.'
        : summary.open_supplier_order_count > summary.lines.length
          ? 'Only the highest-priority supplier lines are shown here.'
          : 'All flagged supplier lines are shown here.',
  };
}

export function buildLateSupplierOrdersAnswer(summary: AssistantLateSupplierOrdersSummary) {
  if (summary.kind === 'no_eta_data') {
    return `I don't know which supplier orders are late because none of the ${formatNumber(summary.open_supplier_order_count)} open supplier lines currently have a verified expected delivery date recorded.`;
  }

  if (summary.kind === 'no_late_orders') {
    return `Late supplier orders: 0. I checked ${formatNumber(summary.tracked_supplier_order_count)} open supplier lines that do have verified expected delivery dates.`;
  }

  const lines = [`Late supplier orders: ${formatNumber(summary.late_supplier_order_count)}`];
  lines.push('');
  lines.push('Most overdue supplier lines:');
  for (const line of summary.lines.slice(0, 5)) {
    const poLabel =
      line.q_number?.trim() ||
      (line.purchase_order_id ? `PO ${line.purchase_order_id}` : 'No PO linked');
    const supplierLabel = line.supplier_name?.trim() || 'Unknown supplier';
    lines.push(
      `- ${poLabel} | ${supplierLabel} | expected ${formatDateForAnswer(line.expected_delivery_date)} | ${formatNumber(line.days_late)} days late | outstanding ${formatNumber(line.outstanding_qty)}`
    );
  }

  return lines.join('\n');
}

export function buildLateSupplierOrdersCard(
  summary: AssistantLateSupplierOrdersSummary
): AssistantCard | undefined {
  if (summary.kind === 'no_eta_data') {
    return {
      type: 'table',
      title: 'Late supplier orders',
      description: 'No verified ETA data is available for current open supplier lines.',
      metrics: [
        {
          label: 'Open supplier lines',
          value: formatNumber(summary.open_supplier_order_count),
        },
      ],
      columns: [{ key: 'status', label: 'Status' }],
      rows: [{ status: 'No verified expected delivery dates recorded' }],
      footer: 'Lateness cannot be verified until ETA data is captured.',
    };
  }

  if (summary.kind === 'no_late_orders') {
    return {
      type: 'table',
      title: 'Late supplier orders',
      description: 'All tracked supplier lines with verified ETA data are currently on time.',
      metrics: [
        {
          label: 'Tracked lines',
          value: formatNumber(summary.tracked_supplier_order_count),
        },
        {
          label: 'Late lines',
          value: '0',
        },
      ],
      columns: [{ key: 'status', label: 'Status' }],
      rows: [{ status: 'No late supplier orders found' }],
      footer: 'Only supplier lines with verified expected delivery dates are considered here.',
    };
  }

  return {
    type: 'table',
    title: 'Late supplier orders',
    description: 'Open supplier lines whose verified ETA is now in the past.',
    metrics: [
      {
        label: 'Late lines',
        value: formatNumber(summary.late_supplier_order_count),
      },
      {
        label: 'Shown',
        value: formatNumber(summary.lines.length),
      },
    ],
    columns: [
      { key: 'po', label: 'Supplier order' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'expected', label: 'Expected' },
      { key: 'days_late', label: 'Days late', align: 'right' },
      { key: 'outstanding', label: 'Outstanding', align: 'right' },
    ],
    rows: summary.lines.map(line => ({
      po:
        line.q_number?.trim() ||
        (line.purchase_order_id ? `PO ${line.purchase_order_id}` : 'No PO linked'),
      supplier: line.supplier_name?.trim() || 'Unknown supplier',
      expected: formatDateForAnswer(line.expected_delivery_date),
      days_late: formatNumber(line.days_late),
      outstanding: formatNumber(line.outstanding_qty),
    })),
    footer:
      summary.late_supplier_order_count > summary.lines.length
        ? 'Only the most overdue supplier lines are shown here.'
        : 'All currently late supplier lines are shown here.',
  };
}
