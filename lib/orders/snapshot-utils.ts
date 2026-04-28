import type { BomSnapshotEntry } from './snapshot-types';

export type CutlistSnapshotSwapEffects = {
  materialOverrides: Map<number, { component_id: number; name: string }>;
  removedMaterialIds: Set<number>;
};

export function calculateBomSnapshotSurchargeTotal(snapshot: unknown): number {
  if (!Array.isArray(snapshot)) return 0;

  const total = (snapshot as Partial<BomSnapshotEntry>[]).reduce((sum, entry) => {
    const amount = Number(entry?.surcharge_amount ?? 0);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);

  return Math.round(total * 100) / 100;
}

export function deriveCutlistSwapEffectsFromBomSnapshot(snapshot: unknown): CutlistSnapshotSwapEffects {
  const materialOverrides = new Map<number, { component_id: number; name: string }>();
  const removedMaterialIds = new Set<number>();

  if (!Array.isArray(snapshot)) {
    return { materialOverrides, removedMaterialIds };
  }

  for (const entry of snapshot as Partial<BomSnapshotEntry>[]) {
    if (!entry?.is_cutlist_item) continue;

    const defaultComponentId = Number(entry.default_component_id ?? entry.component_id);
    const effectiveComponentId = Number(entry.effective_component_id ?? entry.component_id);
    if (!Number.isFinite(defaultComponentId) || defaultComponentId <= 0) continue;

    if (entry.is_removed || entry.swap_kind === 'removed') {
      removedMaterialIds.add(defaultComponentId);
      continue;
    }

    if (
      Number.isFinite(effectiveComponentId) &&
      effectiveComponentId > 0 &&
      effectiveComponentId !== defaultComponentId
    ) {
      materialOverrides.set(defaultComponentId, {
        component_id: effectiveComponentId,
        name:
          entry.effective_component_code ??
          entry.component_description ??
          entry.component_code ??
          String(effectiveComponentId),
      });
    }
  }

  return { materialOverrides, removedMaterialIds };
}
