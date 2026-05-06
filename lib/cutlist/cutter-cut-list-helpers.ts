import type { Placement } from '@/lib/cutlist/types';
import type { AggregateResponse } from '@/lib/orders/cutting-plan-types';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';

export type PlacedBandEdges = {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
};

export function buildPartLabelMap(aggregate: AggregateResponse | null): Map<string, string> {
  const labels = new Map<string, string>();
  for (const group of aggregate?.material_groups ?? []) {
    for (const part of group.parts) {
      const product = part.product_name?.trim();
      const name = part.name?.trim();
      const label = [product, name].filter(Boolean).join(' - ');
      if (label) labels.set(part.id, label);
    }
  }
  return labels;
}

export function getPlacedBandEdges(placement: Placement): PlacedBandEdges {
  const source = placement.band_edges ?? {
    top: false,
    right: false,
    bottom: false,
    left: false,
  };

  if (placement.rot !== 90) {
    return {
      top: !!source.top,
      right: !!source.right,
      bottom: !!source.bottom,
      left: !!source.left,
    };
  }

  return {
    top: !!source.right,
    right: !!source.bottom,
    bottom: !!source.left,
    left: !!source.top,
  };
}

export function slugPart(value: string | number | null | undefined, fallback: string): string {
  const cleaned = String(value ?? fallback)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

export function getCutterCutListFilename(
  orderNumber: string,
  group: CuttingPlanMaterialGroup,
  options?: { draft?: boolean },
): string {
  const orderSlug = slugPart(orderNumber, 'order');
  const materialSlug = slugPart(group.material_name, 'material');
  const draftSuffix = options?.draft ? '-draft' : '';
  return `cut-list-${orderSlug}-${group.kind}-${group.sheet_thickness_mm}mm-${group.material_id}-${materialSlug}${draftSuffix}.pdf`;
}
