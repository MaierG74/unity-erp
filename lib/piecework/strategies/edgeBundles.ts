import type { CountResult, CountingStrategy, PartInBatch } from './types';

function hasAnyBandedEdge(part: PartInBatch): boolean {
  if (!part.bandEdges) return false;
  return Boolean(part.bandEdges.top || part.bandEdges.right || part.bandEdges.bottom || part.bandEdges.left);
}

/**
 * DP #6 row-to-bundle mapping from cutlist/cutting-plan code path:
 * an aggregated row contributes edge bundles by finished assemblies (not raw layers),
 * so `with-backer` and `custom` remain 1 bundle per unit, while `same-board`
 * pairs two cut pieces into one finished bundle (`floor(quantity / 2)`).
 */
function edgeBundlesForPart(part: PartInBatch, finishedModel: boolean): number {
  if (!hasAnyBandedEdge(part)) return 0;

  const qty = Math.max(0, part.quantity);
  if (part.lamination === 'same-board') {
    return finishedModel ? qty : Math.floor(qty / 2);
  }

  return qty;
}

export const countEdgeBundles: CountingStrategy = (batch): CountResult => {
  const finishedModel = batch.sameBoardQuantityModel === 'finished-v1';
  const perPart = batch.parts.map((part) => ({
    partId: part.partId,
    contributesCut: 0,
    contributesEdge: edgeBundlesForPart(part, finishedModel),
  }));

  return {
    count: perPart.reduce((sum, row) => sum + row.contributesEdge, 0),
    breakdown: { perPart },
  };
};
