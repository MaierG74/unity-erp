import type { SupabaseClient } from '@supabase/supabase-js';
import type { BomSnapshotEntry } from '@/lib/orders/snapshot-types';

export type SupplierOrderEvidence = {
  allocation_id: number;
  supplier_order_id: number;
  component_id: number;
  quantity_for_order: number | null;
  received_quantity: number | null;
  status_id: number | null;
  status_name: string | null;
};

export type WorkPoolEvidence = {
  pool_id: number;
  order_detail_id: number | null;
  product_id: number | null;
  job_id: number | null;
  required_qty: number | null;
  status: string | null;
  source: string | null;
  cutting_plan_run_id: number | null;
};

export type JobCardEvidence = {
  item_id: number;
  job_card_id: number;
  product_id: number | null;
  job_id: number | null;
  quantity: number | null;
  status: string | null;
  card_status: string | null;
};

export type DownstreamSwapEvidence = {
  supplier_orders: SupplierOrderEvidence[];
  work_pool_rows: WorkPoolEvidence[];
  job_card_items: JobCardEvidence[];
  order_dispatched: boolean;
  order_status: string | null;
};

export type SwapEventPayload = {
  swap_kind_before: string;
  swap_kind_after: string;
  effective_component_id_before: number | null;
  effective_component_id_after: number | null;
  effective_component_code_before: string | null;
  effective_component_code_after: string | null;
  effective_quantity_before: number | null;
  effective_quantity_after: number | null;
  surcharge_amount_before: number;
  surcharge_amount_after: number;
  surcharge_label_before: string | null;
  surcharge_label_after: string | null;
};

type DownstreamProbeArgs = {
  supabase: SupabaseClient;
  orderId: number;
  sourceComponentId: number;
};

function toNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function changedValue(before: unknown, after: unknown): boolean {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

export function hasDownstreamEvidence(evidence: DownstreamSwapEvidence): boolean {
  return (
    evidence.supplier_orders.length > 0 ||
    evidence.work_pool_rows.length > 0 ||
    evidence.job_card_items.length > 0 ||
    evidence.order_dispatched
  );
}

export function getSwapSourceComponentId(entry: BomSnapshotEntry): number | null {
  return toNumber(entry.default_component_id ?? entry.component_id);
}

export function buildSwapEventPayload(before: BomSnapshotEntry, after: BomSnapshotEntry): SwapEventPayload {
  return {
    swap_kind_before: before.swap_kind ?? 'default',
    swap_kind_after: after.swap_kind ?? 'default',
    effective_component_id_before: toNumber(before.effective_component_id),
    effective_component_id_after: toNumber(after.effective_component_id),
    effective_component_code_before: before.effective_component_code ?? before.component_code ?? null,
    effective_component_code_after: after.effective_component_code ?? after.component_code ?? null,
    effective_quantity_before: toNumber(before.effective_quantity_required),
    effective_quantity_after: toNumber(after.effective_quantity_required),
    surcharge_amount_before: toNumber(before.surcharge_amount) ?? 0,
    surcharge_amount_after: toNumber(after.surcharge_amount) ?? 0,
    surcharge_label_before: before.surcharge_label ?? null,
    surcharge_label_after: after.surcharge_label ?? null,
  };
}

export function findChangedSwapEntries(
  previousSnapshot: BomSnapshotEntry[] | null,
  nextSnapshot: BomSnapshotEntry[] | null
): Array<{ before: BomSnapshotEntry; after: BomSnapshotEntry }> {
  if (!Array.isArray(previousSnapshot) || !Array.isArray(nextSnapshot)) return [];

  const previousBySource = new Map(
    previousSnapshot.map((entry) => [Number(entry.source_bom_id), entry])
  );

  return nextSnapshot.flatMap((after) => {
    const before = previousBySource.get(Number(after.source_bom_id));
    if (!before) return [];

    const changed = [
      changedValue(before.swap_kind, after.swap_kind),
      changedValue(before.effective_component_id, after.effective_component_id),
      changedValue(before.effective_quantity_required, after.effective_quantity_required),
      changedValue(before.surcharge_amount, after.surcharge_amount),
      changedValue(before.surcharge_label, after.surcharge_label),
    ].some(Boolean);

    return changed ? [{ before, after }] : [];
  });
}

export async function probeDownstreamSwapState({
  supabase,
  orderId,
  sourceComponentId,
}: DownstreamProbeArgs): Promise<DownstreamSwapEvidence> {
  const [
    supplierStatusResult,
    orderResult,
    workPoolResult,
    jobCardsResult,
  ] = await Promise.all([
    supabase
      .from('supplier_order_statuses')
      .select('status_id')
      .ilike('status_name', 'cancelled'),
    supabase
      .from('orders')
      .select('status:order_statuses(status_name)')
      .eq('order_id', orderId)
      .maybeSingle(),
    supabase
      .from('job_work_pool')
      .select('pool_id, order_detail_id, product_id, job_id, required_qty, status, source, cutting_plan_run_id')
      .eq('order_id', orderId)
      .eq('source', 'cutting_plan')
      .neq('status', 'cancelled'),
    supabase
      .from('job_cards')
      .select('job_card_id, status')
      .eq('order_id', orderId),
  ]);

  if (supplierStatusResult.error) throw supplierStatusResult.error;
  if (orderResult.error) throw orderResult.error;
  if (workPoolResult.error) throw workPoolResult.error;
  if (jobCardsResult.error) throw jobCardsResult.error;

  const cancelledSupplierStatusIds = (supplierStatusResult.data ?? [])
    .map((row: any) => Number(row.status_id))
    .filter(Number.isFinite);

  const supplierAllocationsResult = await supabase
    .from('supplier_order_customer_orders')
    .select('id, supplier_order_id, component_id, quantity_for_order, received_quantity')
    .eq('order_id', orderId)
    .eq('component_id', sourceComponentId);

  if (supplierAllocationsResult.error) throw supplierAllocationsResult.error;

  const allocationRows = supplierAllocationsResult.data ?? [];
  const supplierOrderIds = [...new Set(allocationRows.map((row: any) => row.supplier_order_id).filter(Boolean))];
  let supplierOrdersById = new Map<number, { status_id: number | null; status_name: string | null }>();

  if (supplierOrderIds.length > 0) {
    let supplierOrderQuery = supabase
      .from('supplier_orders')
      .select('order_id, status_id, status:supplier_order_statuses(status_name)')
      .in('order_id', supplierOrderIds);

    if (cancelledSupplierStatusIds.length > 0) {
      supplierOrderQuery = supplierOrderQuery.not('status_id', 'in', `(${cancelledSupplierStatusIds.join(',')})`);
    }

    const supplierOrdersResult = await supplierOrderQuery;
    if (supplierOrdersResult.error) throw supplierOrdersResult.error;

    supplierOrdersById = new Map(
      (supplierOrdersResult.data ?? []).map((row: any) => [
        Number(row.order_id),
        {
          status_id: row.status_id ?? null,
          status_name: row.status?.status_name ?? null,
        },
      ])
    );
  }

  const jobCardIds = (jobCardsResult.data ?? []).map((row: any) => row.job_card_id).filter(Boolean);
  const cardStatusById = new Map((jobCardsResult.data ?? []).map((row: any) => [row.job_card_id, row.status ?? null]));
  let jobCardItems: JobCardEvidence[] = [];

  if (jobCardIds.length > 0) {
    const jobCardItemsResult = await supabase
      .from('job_card_items')
      .select('item_id, job_card_id, product_id, job_id, quantity, status')
      .in('job_card_id', jobCardIds)
      .neq('status', 'cancelled');

    if (jobCardItemsResult.error) throw jobCardItemsResult.error;

    jobCardItems = (jobCardItemsResult.data ?? []).map((row: any) => ({
      item_id: row.item_id,
      job_card_id: row.job_card_id,
      product_id: row.product_id ?? null,
      job_id: row.job_id ?? null,
      quantity: row.quantity ?? null,
      status: row.status ?? null,
      card_status: cardStatusById.get(row.job_card_id) ?? null,
    }));
  }

  const statusName = Array.isArray((orderResult.data as any)?.status)
    ? (orderResult.data as any).status[0]?.status_name ?? null
    : (orderResult.data as any)?.status?.status_name ?? null;

  return {
    supplier_orders: allocationRows.flatMap((row: any) => {
      const supplierOrder = supplierOrdersById.get(Number(row.supplier_order_id));
      if (!supplierOrder) return [];
      return [{
        allocation_id: row.id,
        supplier_order_id: row.supplier_order_id,
        component_id: row.component_id,
        quantity_for_order: row.quantity_for_order ?? null,
        received_quantity: row.received_quantity ?? null,
        status_id: supplierOrder.status_id,
        status_name: supplierOrder.status_name,
      }];
    }),
    work_pool_rows: (workPoolResult.data ?? []).map((row: any) => ({
      pool_id: row.pool_id,
      order_detail_id: row.order_detail_id ?? null,
      product_id: row.product_id ?? null,
      job_id: row.job_id ?? null,
      required_qty: row.required_qty ?? null,
      status: row.status ?? null,
      source: row.source ?? null,
      cutting_plan_run_id: row.cutting_plan_run_id ?? null,
    })),
    job_card_items: jobCardItems,
    order_dispatched: ['ready for delivery', 'completed', 'dispatched', 'shipped'].includes(
      String(statusName ?? '').trim().toLowerCase()
    ),
    order_status: statusName,
  };
}
