import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
import {
  ACTIVITY_CODES,
  STRATEGIES,
  type ActivityCode,
  type CuttingPlanBatch,
  type PartInBatch,
} from '@/lib/piecework/strategies';

type ActivePieceworkActivity = {
  id: string;
  code: string;
  label: string;
  default_rate: number | string | null;
  target_role_id: number | null;
};

export type CuttingPlanWorkPoolCandidate = {
  order_id: number;
  source: 'cutting_plan';
  cutting_plan_run_id: number;
  piecework_activity_id: string;
  material_color_label: string;
  expected_count: number;
  required_qty: number;
  pay_type: 'piece';
  piece_rate: number;
  status: 'active';
};

export type ExistingCuttingPlanPoolRow = {
  pool_id: number;
  piecework_activity_id: string | null;
  material_color_label: string | null;
  expected_count: number | null;
  required_qty: number;
  issued_qty: number;
  status: string;
};

export type PoolReconcileInsert = CuttingPlanWorkPoolCandidate;
export type PoolReconcileUpdate = {
  pool_id: number;
  expected_count: number;
  required_qty: number;
  material_color_label: string;
  piece_rate: number;
};
export type PoolReconcileException = {
  pool_id: number;
  required_qty_snapshot: number;
  issued_qty_snapshot: number;
  variance_qty: number;
  material_color_label: string;
  expected_count: number;
  previous_required_qty: number;
};

export type PoolReconcilePlan = {
  inserts: PoolReconcileInsert[];
  updates: PoolReconcileUpdate[];
  exceptions: PoolReconcileException[];
};

function isActivityCode(code: string): code is ActivityCode {
  return code in STRATEGIES;
}

function normalizeBandEdges(value: unknown): PartInBatch['bandEdges'] {
  if (!value || typeof value !== 'object') return null;
  const edges = value as Record<string, unknown>;
  return {
    top: Boolean(edges.top),
    right: Boolean(edges.right),
    bottom: Boolean(edges.bottom),
    left: Boolean(edges.left),
  };
}

function customLayerCount(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const layers = (value as { layers?: unknown }).layers;
  return Array.isArray(layers) && layers.length > 0 ? layers.length : undefined;
}

function batchLabel(group: CuttingPlan['material_groups'][number]): string {
  return [
    group.primary_material_name ?? (group.primary_material_id != null ? `Material ${group.primary_material_id}` : null),
    group.backer_material_name ?? (group.backer_material_id != null ? `Backer ${group.backer_material_id}` : null),
    group.board_type,
  ].filter(Boolean).join(' / ') || 'Unassigned material';
}

export function cuttingPlanToPieceworkBatches(orderId: number, plan: CuttingPlan): CuttingPlanBatch[] {
  return plan.material_groups
    .map((group) => {
      const partsById = new Map<string, PartInBatch>();
      for (const layout of group.layouts ?? []) {
        for (const placement of layout.placements ?? []) {
          const partId = placement.part_id;
          const existing = partsById.get(partId);
          if (existing) {
            existing.quantity += 1;
            continue;
          }

          partsById.set(partId, {
            partId,
            quantity: 1,
            lamination: (placement.lamination_type ?? 'none') as PartInBatch['lamination'],
            bandEdges: normalizeBandEdges(placement.band_edges),
            customLayerCount: customLayerCount((placement as { lamination_config?: unknown }).lamination_config),
          });
        }
      }

      return {
        cuttingPlanRunId: String(orderId),
        materialColorLabel: batchLabel(group),
        parts: Array.from(partsById.values()),
      };
    })
    .filter((batch) => batch.parts.length > 0);
}

export function buildCuttingPlanWorkPoolCandidates(
  orderId: number,
  plan: CuttingPlan,
  activities: ActivePieceworkActivity[],
): CuttingPlanWorkPoolCandidate[] {
  const batches = cuttingPlanToPieceworkBatches(orderId, plan);
  if (batches.length === 0) return [];

  const activeActivities = activities.filter((activity) => isActivityCode(activity.code));
  if (activeActivities.length === 0) return [];

  const candidates: CuttingPlanWorkPoolCandidate[] = [];
  for (const batch of batches) {
    for (const activity of activeActivities) {
      const code = activity.code as ActivityCode;
      const result = STRATEGIES[code](batch);
      if (result.count <= 0) continue;
      if (code === ACTIVITY_CODES.EDGE_BUNDLES && result.count === 0) continue;

      candidates.push({
        order_id: orderId,
        source: 'cutting_plan',
        cutting_plan_run_id: orderId,
        piecework_activity_id: activity.id,
        material_color_label: batch.materialColorLabel,
        expected_count: result.count,
        required_qty: result.count,
        pay_type: 'piece',
        piece_rate: Number(activity.default_rate ?? 0),
        status: 'active',
      });
    }
  }

  return candidates;
}

export function reconcileCuttingPlanWorkPool(
  candidates: CuttingPlanWorkPoolCandidate[],
  existingRows: ExistingCuttingPlanPoolRow[],
): PoolReconcilePlan {
  const existingByKey = new Map<string, ExistingCuttingPlanPoolRow>();
  for (const row of existingRows) {
    if (!row.piecework_activity_id || !row.material_color_label || row.status !== 'active') continue;
    existingByKey.set(`${row.piecework_activity_id}::${row.material_color_label}`, row);
  }

  const plan: PoolReconcilePlan = { inserts: [], updates: [], exceptions: [] };
  for (const candidate of candidates) {
    const key = `${candidate.piecework_activity_id}::${candidate.material_color_label}`;
    const existing = existingByKey.get(key);
    if (!existing) {
      plan.inserts.push(candidate);
      continue;
    }

    const unchanged =
      existing.required_qty === candidate.required_qty &&
      (existing.expected_count ?? existing.required_qty) === candidate.expected_count &&
      existing.material_color_label === candidate.material_color_label;
    if (unchanged) continue;

    if (existing.issued_qty > 0) {
      plan.exceptions.push({
        pool_id: existing.pool_id,
        required_qty_snapshot: candidate.required_qty,
        issued_qty_snapshot: existing.issued_qty,
        variance_qty: candidate.required_qty - existing.issued_qty,
        material_color_label: candidate.material_color_label,
        expected_count: candidate.expected_count,
        previous_required_qty: existing.required_qty,
      });
      continue;
    }

    plan.updates.push({
      pool_id: existing.pool_id,
      expected_count: candidate.expected_count,
      required_qty: candidate.required_qty,
      material_color_label: candidate.material_color_label,
      piece_rate: candidate.piece_rate,
    });
  }

  return plan;
}
