import type { CountResult, CountingStrategy, PartInBatch } from './types';

/**
 * DP #6 row-to-piece mapping from cutlist/cutting-plan code path:
 * one aggregated `PartSpec` row keeps its own `quantity` and lamination metadata,
 * where `with-backer` means 2 cut layers per unit, `same-board` is already piece-counted,
 * and `custom` expands to N layers per unit (from `customLayerCount`).
 */
function cutPiecesForPart(part: PartInBatch): number {
  const qty = Math.max(0, part.quantity);

  switch (part.lamination) {
    case 'with-backer':
      return qty * 2;
    case 'custom': {
      const layers = Math.max(1, part.customLayerCount ?? 1);
      return qty * layers;
    }
    case 'none':
    case 'same-board':
    default:
      return qty;
  }
}

export const countCutPieces: CountingStrategy = (batch): CountResult => {
  const perPart = batch.parts.map((part) => ({
    partId: part.partId,
    contributesCut: cutPiecesForPart(part),
    contributesEdge: 0,
  }));

  return {
    count: perPart.reduce((sum, row) => sum + row.contributesCut, 0),
    breakdown: { perPart },
  };
};
