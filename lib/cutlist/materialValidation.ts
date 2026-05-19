import type { BoardMaterial, CompactPart } from '@/components/features/cutlist/primitives';

export interface MaterialReconciliationResult {
  parts: CompactPart[];
  invalidParts: CompactPart[];
  changed: boolean;
}

export function partNeedsPrimaryBoard(part: CompactPart): boolean {
  return part.length_mm > 0 && part.width_mm > 0 && part.quantity > 0;
}

export function reconcilePartMaterials(
  parts: CompactPart[],
  primaryBoards: BoardMaterial[]
): MaterialReconciliationResult {
  const boardById = new Map(primaryBoards.map((board) => [board.id, board]));
  const onlyBoard = primaryBoards.length === 1 ? primaryBoards[0] : null;
  const invalidParts: CompactPart[] = [];
  let changed = false;

  const reconciledParts = parts.map((part) => {
    if (!partNeedsPrimaryBoard(part)) return part;

    const currentBoard = part.material_id ? boardById.get(part.material_id) : undefined;
    const board = currentBoard ?? onlyBoard;

    if (!board) {
      invalidParts.push(part);
      return part;
    }

    const nextPart: CompactPart = {
      ...part,
      material_id: board.id,
      material_label: board.name,
      material_thickness: part.material_thickness ?? 16,
    };

    if (
      nextPart.material_id !== part.material_id ||
      nextPart.material_label !== part.material_label ||
      nextPart.material_thickness !== part.material_thickness
    ) {
      changed = true;
      return nextPart;
    }

    return part;
  });

  return { parts: reconciledParts, invalidParts, changed };
}

export function formatInvalidMaterialParts(parts: CompactPart[]): string {
  return parts
    .slice(0, 4)
    .map((part) => part.name || part.id)
    .join(', ');
}
