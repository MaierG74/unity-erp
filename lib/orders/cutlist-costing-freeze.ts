import type { SupabaseClient } from '@supabase/supabase-js';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

type SnapshotRow = {
  snapshot_data?: unknown;
};

export type CutlistCostingSnapshotSource = 'order_line' | 'product_template' | 'none';

export function resolveCutlistCostingSnapshot(
  orderLineSnapshot: unknown,
  productTemplateSnapshot: unknown,
): {
  snapshot: CutlistCostingSnapshot | null;
  source: CutlistCostingSnapshotSource;
} {
  if (isSnapshotObject(orderLineSnapshot)) {
    return {
      snapshot: orderLineSnapshot as unknown as CutlistCostingSnapshot,
      source: 'order_line',
    };
  }

  if (isSnapshotObject(productTemplateSnapshot)) {
    return {
      snapshot: productTemplateSnapshot as unknown as CutlistCostingSnapshot,
      source: 'product_template',
    };
  }

  return {
    snapshot: null,
    source: 'none',
  };
}

export async function fetchProductCutlistCostingSnapshot(
  supabase: Pick<SupabaseClient, 'from'>,
  productId: number | null | undefined,
): Promise<CutlistCostingSnapshot | null> {
  if (productId == null) return null;

  const { data, error } = await supabase
    .from('product_cutlist_costing_snapshots')
    .select('snapshot_data')
    .eq('product_id', productId)
    .maybeSingle<SnapshotRow>();

  if (error) {
    throw error;
  }

  return isSnapshotObject(data?.snapshot_data)
    ? data.snapshot_data as unknown as CutlistCostingSnapshot
    : null;
}

function isSnapshotObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
