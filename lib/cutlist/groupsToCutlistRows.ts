import type { CutlistDimensions } from '@/lib/cutlist/cutlistDimensions';
import type { DatabaseCutlistGroup } from '@/lib/cutlist/productCutlistLoader';

export interface GroupCutlistRow {
  key: string;
  bomId: number | null;
  componentId: number;
  componentCode: string;
  componentDescription: string | null;
  source: 'direct' | 'link' | 'rpc';
  isEditable: boolean;
  category: string | null;
  dimensions: CutlistDimensions | null;
  quantityRequired: number;
  quantityPer: number;
  totalParts: number;
}

export function groupsToCutlistRows(
  groups: DatabaseCutlistGroup[]
): GroupCutlistRow[] {
  const rows: GroupCutlistRow[] = [];

  for (const group of groups) {
    const materialLabel =
      group.primary_material_name?.trim() || group.name?.trim() || 'Unassigned';
    const materialCode = group.primary_material_id
      ? String(group.primary_material_id)
      : null;

    const groupParts = group.parts ?? [];
    for (let partIndex = 0; partIndex < groupParts.length; partIndex++) {
      const part = groupParts[partIndex];
      const length = Number(part.length_mm) || 0;
      const width = Number(part.width_mm) || 0;
      const qty = Number(part.quantity) || 0;

      const effectiveBoardId = (part as { effective_board_id?: number | null }).effective_board_id ?? group.primary_material_id;
      const effectiveBoardName =
        (part as { effective_board_name?: string | null }).effective_board_name ??
        group.primary_material_name ??
        materialLabel;

      const dimensions: CutlistDimensions = {
        length_mm: length,
        width_mm: width,
        quantity_per: 1,
        material_code: effectiveBoardId != null ? String(effectiveBoardId) : materialCode ?? undefined,
        material_label: effectiveBoardName,
        colour_family: effectiveBoardName,
        grain: part.grain,
        notes: part.name,
      };

      rows.push({
        key: `group:${group.id}:${part.id}:${partIndex}`,
        bomId: null,
        componentId: -1,
        componentCode: part.name || 'Part',
        componentDescription: effectiveBoardName,
        source: 'direct',
        isEditable: false,
        category: group.board_type ?? null,
        dimensions,
        quantityRequired: qty,
        quantityPer: 1,
        totalParts: qty,
      });
    }
  }

  return rows;
}
