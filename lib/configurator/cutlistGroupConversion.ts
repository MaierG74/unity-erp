import type { CutlistPart, BoardType, LaminationType } from '@/lib/cutlist/types';
import type { CompactPart } from '@/components/features/cutlist/primitives/CompactPartsTable';

/**
 * Database group format from the product cutlist API.
 */
interface DatabaseCutlistGroup {
  id: number;
  product_id: number;
  name: string;
  board_type: BoardType;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: CutlistPart[];
  sort_order: number;
}

/**
 * API group format for saving back via POST.
 */
interface ApiCutlistGroup {
  name: string;
  board_type: BoardType;
  primary_material_id: string | null;
  primary_material_name: string | null;
  backer_material_id: string | null;
  backer_material_name: string | null;
  parts: CutlistPart[];
  sort_order: number;
}

const BOARD_TYPE_TO_LAMINATION: Record<BoardType, LaminationType> = {
  '16mm': 'none',
  '32mm-both': 'same-board',
  '32mm-backer': 'with-backer',
};

const LAMINATION_TO_BOARD_TYPE: Record<string, BoardType> = {
  none: '16mm',
  'same-board': '32mm-both',
  'with-backer': '32mm-backer',
  custom: '16mm', // custom lamination defaults to 16mm group
};

/**
 * Flatten product cutlist groups into a flat CompactPart[] array.
 * Sets lamination_type and material_id on each part from its group.
 */
export function flattenGroupsToCompactParts(
  groups: DatabaseCutlistGroup[]
): CompactPart[] {
  return groups.flatMap((group) =>
    group.parts.map((part) => ({
      ...part,
      lamination_type: part.lamination_type || BOARD_TYPE_TO_LAMINATION[group.board_type] || 'none',
      lamination_config: part.lamination_config as CompactPart['lamination_config'],
      material_id: part.material_id || group.primary_material_id?.toString() || undefined,
    }))
  );
}

/**
 * Regroup flat CompactPart[] back into API groups for saving.
 * Groups by (lamination_type, material_id) tuple.
 */
export function regroupPartsToApiGroups(
  parts: CompactPart[]
): ApiCutlistGroup[] {
  const groupMap = new Map<string, { parts: CutlistPart[]; boardType: BoardType; materialId: string | null }>();

  for (const part of parts) {
    const lam = part.lamination_type || 'none';
    const matId = part.material_id || '';
    const key = `${lam}::${matId}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        parts: [],
        boardType: LAMINATION_TO_BOARD_TYPE[lam] || '16mm',
        materialId: matId || null,
      });
    }

    // Convert back to CutlistPart (strip CompactPart-specific fields)
    const cutlistPart: CutlistPart = {
      id: part.id,
      name: part.name,
      length_mm: part.length_mm,
      width_mm: part.width_mm,
      quantity: part.quantity,
      grain: part.grain,
      band_edges: part.band_edges,
      lamination_type: part.lamination_type,
      lamination_config: part.lamination_config,
      material_id: part.material_id,
      material_label: part.material_label,
      edging_material_id: part.edging_material_id,
      lamination_group: part.lamination_group,
    };

    groupMap.get(key)!.parts.push(cutlistPart);
  }

  const groups: ApiCutlistGroup[] = [];
  let sortOrder = 0;

  for (const [, value] of groupMap) {
    const boardType = value.boardType;
    const label = boardType === '16mm' ? 'Panels (16mm)' : boardType === '32mm-both' ? 'Laminated (32mm)' : 'Laminated w/ Backer (32mm)';

    groups.push({
      name: label,
      board_type: boardType,
      primary_material_id: value.materialId,
      primary_material_name: null,
      backer_material_id: null,
      backer_material_name: null,
      parts: value.parts,
      sort_order: sortOrder++,
    });
  }

  return groups;
}
