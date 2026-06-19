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
    if (part.laminationGroup) return qty;
    return finishedModel ? qty : Math.floor(qty / 2);
  }

  return qty;
}

function groupedSameBoardKey(part: PartInBatch): string {
  return `${part.laminationGroupSourceId ?? '__batch__'}::${part.laminationGroup ?? ''}`;
}

export const countEdgeBundles: CountingStrategy = (batch): CountResult => {
  const finishedModel = batch.sameBoardQuantityModel === 'finished-v1';
  const groupMax = new Map<string, number>();
  const groupFirstIndex = new Map<string, number>();
  const sourceTotals = new Map<string, number>();
  const sourceFirstIndex = new Map<string, number>();

  batch.parts.forEach((part, index) => {
    if (part.lamination !== 'same-board' || !hasAnyBandedEdge(part)) return;
    if (part.laminationGroup) {
      const key = groupedSameBoardKey(part);
      groupMax.set(key, Math.max(groupMax.get(key) ?? 0, Math.max(0, part.quantity)));
      if (!groupFirstIndex.has(key)) groupFirstIndex.set(key, index);
      return;
    }
    if (part.sameBoardSourceId) {
      const key = part.sameBoardSourceId;
      sourceTotals.set(key, (sourceTotals.get(key) ?? 0) + Math.max(0, part.quantity));
      if (!sourceFirstIndex.has(key)) sourceFirstIndex.set(key, index);
    }
  });

  const perPart = batch.parts.map((part, index) => {
    let contributesEdge = edgeBundlesForPart(part, finishedModel);
    if (part.lamination === 'same-board' && part.laminationGroup) {
      const key = groupedSameBoardKey(part);
      const firstIndex = groupFirstIndex.get(key);
      contributesEdge = firstIndex === index ? groupMax.get(key) ?? 0 : 0;
    } else if (part.lamination === 'same-board' && part.sameBoardSourceId) {
      const firstIndex = sourceFirstIndex.get(part.sameBoardSourceId);
      contributesEdge = firstIndex === index ? Math.floor((sourceTotals.get(part.sameBoardSourceId) ?? 0) / 2) : 0;
    }

    return {
      partId: part.partId,
      contributesCut: 0,
      contributesEdge,
    };
  });

  return {
    count: perPart.reduce((sum, row) => sum + row.contributesEdge, 0),
    breakdown: { perPart },
  };
};
