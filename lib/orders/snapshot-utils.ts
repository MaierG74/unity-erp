import type { BomSnapshotEntry, BomSnapshotSwapKind } from './snapshot-types';

export type BomSnapshotSubstitution = {
  bom_id: number;
  component_id?: number | null;
  supplier_component_id?: number | null;
  swap_kind?: BomSnapshotSwapKind;
  is_removed?: boolean;
  surcharge_amount?: number | string | null;
  surcharge_label?: string | null;
  note?: string | null;
};

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

export function calculateBomSnapshotLineSurchargeTotal(snapshot: unknown, quantity: number): number {
  const lineQuantity = Number(quantity);
  const surchargeTotal = calculateBomSnapshotSurchargeTotal(snapshot);

  if (!Number.isFinite(lineQuantity) || lineQuantity === 0) return 0;
  return Math.round(surchargeTotal * lineQuantity * 100) / 100;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasCarriedSwapIntent(entry: Partial<BomSnapshotEntry>): boolean {
  const swapKind = entry.swap_kind ?? 'default';
  const surchargeAmount = numeric(entry.surcharge_amount) ?? 0;
  return (
    swapKind !== 'default' ||
    entry.is_removed === true ||
    entry.is_substituted === true ||
    Math.abs(surchargeAmount) > 0
  );
}

export function substitutionsFromBomSnapshot(snapshot: unknown): BomSnapshotSubstitution[] {
  if (!Array.isArray(snapshot)) return [];

  return (snapshot as Partial<BomSnapshotEntry>[])
    .filter((entry) => hasCarriedSwapIntent(entry))
    .flatMap((entry) => {
      const bomId = numeric(entry.source_bom_id);
      if (!bomId || bomId <= 0) return [];

      const removed = entry.swap_kind === 'removed' || entry.is_removed === true;
      const effectiveComponentId = numeric(entry.effective_component_id ?? entry.component_id);
      const defaultComponentId = numeric(entry.default_component_id);
      const swapKind: BomSnapshotSwapKind = removed
        ? 'removed'
        : effectiveComponentId && defaultComponentId && effectiveComponentId !== defaultComponentId
          ? 'alternative'
          : (entry.swap_kind === 'alternative' ? 'alternative' : 'default');

      return [{
        bom_id: bomId,
        component_id: removed ? defaultComponentId : effectiveComponentId,
        supplier_component_id: numeric(entry.supplier_component_id),
        swap_kind: swapKind,
        is_removed: removed,
        surcharge_amount: numeric(entry.surcharge_amount) ?? 0,
        surcharge_label: entry.surcharge_label ?? null,
        note: entry.note ?? null,
      }];
    });
}

export function countDroppedBomSnapshotSubstitutions(
  substitutions: BomSnapshotSubstitution[],
  rebuiltSnapshot: unknown
): number {
  if (substitutions.length === 0) return 0;
  const rebuiltSourceIds = new Set(
    Array.isArray(rebuiltSnapshot)
      ? (rebuiltSnapshot as Partial<BomSnapshotEntry>[])
          .map((entry) => numeric(entry.source_bom_id))
          .filter((id): id is number => Boolean(id && id > 0))
      : []
  );

  return substitutions.filter((substitution) => !rebuiltSourceIds.has(substitution.bom_id)).length;
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
