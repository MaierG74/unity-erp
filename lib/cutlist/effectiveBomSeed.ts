import type { CompactPart } from '@/components/features/cutlist/primitives/CompactPartsTable';
import type { CutlistDimensions } from '@/lib/cutlist/cutlistDimensions';

export interface EffectiveBomSeedRow {
  key: string;
  componentId: number;
  componentCode?: string | null;
  componentDescription?: string | null;
  dimensions: CutlistDimensions | null;
  totalParts: number;
}

const DEFAULT_BAND_EDGES = {
  top: false,
  right: false,
  bottom: false,
  left: false,
} as const;

export function effectiveBomRowsToCompactParts(rows: EffectiveBomSeedRow[]): CompactPart[] {
  return rows.flatMap((row, index) => {
    const dimensions = row.dimensions;
    if (!dimensions?.length_mm || !dimensions?.width_mm) {
      return [];
    }

    const quantity = Number(row.totalParts ?? 0);
    if (!(quantity > 0)) {
      return [];
    }

    const materialLabel =
      dimensions.material_label?.trim() ||
      dimensions.material_code?.trim() ||
      undefined;

    return [
      {
        id: row.key || `bom-seed-${index + 1}`,
        name:
          dimensions.notes?.trim() ||
          row.componentCode?.trim() ||
          row.componentDescription?.trim() ||
          `Component #${row.componentId}`,
        length_mm: dimensions.length_mm,
        width_mm: dimensions.width_mm,
        quantity,
        grain: dimensions.grain ?? 'length',
        band_edges: {
          top: dimensions.band_edges?.top ?? DEFAULT_BAND_EDGES.top,
          right: dimensions.band_edges?.right ?? DEFAULT_BAND_EDGES.right,
          bottom: dimensions.band_edges?.bottom ?? DEFAULT_BAND_EDGES.bottom,
          left: dimensions.band_edges?.left ?? DEFAULT_BAND_EDGES.left,
        },
        lamination_type: dimensions.laminate?.enabled ? 'with-backer' : 'none',
        material_label: materialLabel,
        material_thickness: dimensions.thickness_mm,
      },
    ];
  });
}
