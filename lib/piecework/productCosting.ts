import type { SupabaseClient } from '@supabase/supabase-js';

import type { CompactPart } from '@/components/features/cutlist/primitives/CompactPartsTable';
import {
  effectiveBomItemsToSeedRows,
  type CutlistCalculatorInitialData,
} from '@/lib/cutlist/calculatorData';
import { effectiveBomRowsToCompactParts } from '@/lib/cutlist/effectiveBomSeed';
import { flattenGroupsToCompactParts } from '@/lib/configurator/cutlistGroupConversion';
import {
  STRATEGIES,
  type ActivityCode,
  type CuttingPlanBatch,
  type PartInBatch,
} from '@/lib/piecework/strategies';

export interface PieceworkLaborLine {
  activityId: string;
  activityCode: ActivityCode;
  activityLabel: string;
  unitLabel: string;
  count: number;
  rate: number;
  total: number;
  breakdown?: Array<{
    partId: string;
    contributesCut: number;
    contributesEdge: number;
  }>;
}

type PieceworkActivityRow = {
  id: string;
  code: string;
  label: string;
  default_rate: number | string | null;
  unit_label: string | null;
};

function isActivityCode(value: string): value is ActivityCode {
  return value in STRATEGIES;
}

function normalizeBandEdges(part: CompactPart): PartInBatch['bandEdges'] {
  const edges = part.band_edges;
  if (!edges) return null;
  return {
    top: Boolean(edges.top),
    right: Boolean(edges.right),
    bottom: Boolean(edges.bottom),
    left: Boolean(edges.left),
  };
}

function customLayerCount(part: CompactPart): number | undefined {
  if (part.lamination_type !== 'custom') return undefined;
  const layers = part.lamination_config?.layers;
  return Array.isArray(layers) && layers.length > 0 ? layers.length : undefined;
}

export function compactPartsToCuttingPlanBatches(parts: CompactPart[]): CuttingPlanBatch[] {
  const batches = new Map<string, CuttingPlanBatch>();

  for (const part of parts) {
    const quantity = Number(part.quantity ?? 0);
    if (!(quantity > 0)) continue;

    const materialKey = part.material_id || part.material_label || 'unassigned';
    const materialLabel = part.material_label || (part.material_id ? `Material ${part.material_id}` : 'Unassigned material');
    const batchKey = `${materialKey}::${part.material_thickness ?? ''}`;

    if (!batches.has(batchKey)) {
      batches.set(batchKey, {
        cuttingPlanRunId: `product-costing:${batchKey}`,
        materialColorLabel: materialLabel,
        parts: [],
      });
    }

    batches.get(batchKey)!.parts.push({
      partId: part.id,
      quantity,
      lamination: part.lamination_type ?? 'none',
      bandEdges: normalizeBandEdges(part),
      customLayerCount: customLayerCount(part),
    });
  }

  return Array.from(batches.values()).filter((batch) => batch.parts.length > 0);
}

async function loadProductCutlistParts(
  productId: string,
  orgId: string,
  supabase: SupabaseClient
): Promise<CutlistCalculatorInitialData | null> {
  const numericProductId = Number(productId);
  const { data: groups, error: groupsError } = await supabase
    .from('product_cutlist_groups')
    .select('*')
    .eq('product_id', numericProductId)
    .eq('org_id', orgId)
    .order('sort_order', { ascending: true });

  if (groupsError) throw groupsError;
  if (Array.isArray(groups) && groups.length > 0) {
    return { parts: flattenGroupsToCompactParts(groups as never[]) };
  }

  const { data: resolved, error: resolvedError } = await supabase.rpc('get_product_components', {
    _product_id: numericProductId,
    _selected_options: {},
  });

  if (resolvedError || !Array.isArray(resolved) || resolved.length === 0) {
    const { data: fallback, error: fallbackError } = await supabase
      .from('billofmaterials')
      .select('bom_id, component_id, quantity_required, cutlist_dimensions')
      .eq('product_id', numericProductId);

    if (fallbackError) throw fallbackError;

    const parts = effectiveBomRowsToCompactParts(effectiveBomItemsToSeedRows((fallback ?? []) as Record<string, unknown>[]));
    return parts.length > 0 ? { parts } : null;
  }

  const normalized = resolved.map((row: Record<string, unknown>) => ({
    bom_id: row.bom_id ?? null,
    component_id: Number(row.component_id ?? 0),
    quantity_required: Number(row.quantity ?? row.quantity_required ?? 0),
    cutlist_dimensions: row.cutlist_dimensions ?? null,
    component_description: row.component_description ?? null,
  }));
  const parts = effectiveBomRowsToCompactParts(effectiveBomItemsToSeedRows(normalized));
  return parts.length > 0 ? { parts } : null;
}

/**
 * Computes product costing labor from configured piecework activities by loading the
 * product cutlist, grouping parts into material batches, running registered counting
 * strategies, and returning read-only labor rows for product unit-cost rollups.
 */
export async function computeProductPieceworkLabor(
  productId: string,
  orgId: string,
  supabase: SupabaseClient
): Promise<PieceworkLaborLine[]> {
  const { data: activities, error: activitiesError } = await supabase
    .from('piecework_activities')
    .select('id, code, label, default_rate, unit_label')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('label', { ascending: true });

  if (activitiesError) throw activitiesError;

  const activeActivities = ((activities ?? []) as PieceworkActivityRow[]).filter((activity) =>
    isActivityCode(activity.code)
  );
  if (activeActivities.length === 0) return [];

  const cutlist = await loadProductCutlistParts(productId, orgId, supabase);
  const batches = compactPartsToCuttingPlanBatches((cutlist?.parts ?? []) as CompactPart[]);
  if (batches.length === 0) return [];

  return activeActivities
    .map((activity) => {
      const strategy = STRATEGIES[activity.code as ActivityCode];
      const totals = batches.map((batch) => strategy(batch));
      const count = totals.reduce((sum, result) => sum + result.count, 0);
      const rate = Number(activity.default_rate ?? 0);

      return {
        activityId: activity.id,
        activityCode: activity.code as ActivityCode,
        activityLabel: activity.label,
        unitLabel: activity.unit_label || 'unit',
        count,
        rate,
        total: count * rate,
        breakdown: totals.flatMap((result) => result.breakdown.perPart),
      };
    })
    .filter((line) => line.count > 0)
    .sort((a, b) => a.activityLabel.localeCompare(b.activityLabel));
}
