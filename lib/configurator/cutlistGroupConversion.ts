import type { CutlistPart, BoardType, LaminationType } from '@/lib/cutlist/types';
import type { CompactPart } from '@/components/features/cutlist/primitives/CompactPartsTable';
import { boardTypeToLamination, parseSheetThickness, getBoardTypeLabel } from '@/lib/cutlist/boardCalculator';

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

/**
 * Derive board_type string from lamination type and material thickness.
 */
function laminationToBoardType(lam: LaminationType, materialThickness: number = 16): BoardType {
  switch (lam) {
    case 'same-board':
      return `${materialThickness * 2}mm-both`;
    case 'with-backer':
      return `${materialThickness * 2}mm-backer`;
    case 'custom':
    case 'none':
    default:
      return `${materialThickness}mm`;
  }
}

/**
 * Flatten product cutlist groups into a flat CompactPart[] array.
 * Sets lamination_type and material_id on each part from its group.
 */
export function flattenGroupsToCompactParts(
  groups: DatabaseCutlistGroup[]
): CompactPart[] {
  return groups.flatMap((group) => {
    const groupLamination = boardTypeToLamination(group.board_type);
    const sheetThickness = parseSheetThickness(group.board_type);
    return group.parts.map((part) => ({
      ...part,
      lamination_type: part.lamination_type || groupLamination,
      lamination_config: part.lamination_config as CompactPart['lamination_config'],
      material_id: part.material_id || group.primary_material_id?.toString() || undefined,
      material_thickness: part.material_thickness || sheetThickness,
    }));
  });
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
    const mt = part.material_thickness || 16;
    const key = `${lam}::${matId}::${mt}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        parts: [],
        boardType: laminationToBoardType(lam, mt),
        materialId: matId || null,
      });
    }

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
      material_thickness: part.material_thickness,
    };

    groupMap.get(key)!.parts.push(cutlistPart);
  }

  const groups: ApiCutlistGroup[] = [];
  let sortOrder = 0;

  for (const [, value] of groupMap) {
    groups.push({
      name: getBoardTypeLabel(value.boardType),
      board_type: value.boardType,
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
