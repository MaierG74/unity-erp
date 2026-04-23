/**
 * Decide whether saving a cutlist costing snapshot is safe.
 *
 * A snapshot freezes a calculated layout (sheet counts, edging meters, sheet
 * billing overrides). The snapshot is read back later by the product costing
 * tab, keyed off a parts_hash — so if the user edits parts after the layout
 * was calculated and then saves, the snapshot would commit a stale layout
 * with a fresh hash, making the product costing tab silently wrong.
 *
 * The gate requires that the current parts hash equals the hash of the parts
 * that produced the current result. Caller should refuse to save otherwise
 * and prompt the user to recalculate.
 */
export type SnapshotSaveDecision =
  | { canSave: true; partsHash: string }
  | { canSave: false; reason: string };

export function decideSnapshotSave(args: {
  resultPartsHash: string | undefined;
  currentPartsHash: string | undefined;
}): SnapshotSaveDecision {
  const { resultPartsHash, currentPartsHash } = args;

  if (!resultPartsHash) {
    return {
      canSave: false,
      reason: 'No layout has been calculated — recalculate before saving.',
    };
  }
  if (!currentPartsHash) {
    return {
      canSave: false,
      reason: 'No parts to save.',
    };
  }
  if (resultPartsHash !== currentPartsHash) {
    return {
      canSave: false,
      reason: 'Parts have changed since the last layout — recalculate before saving.',
    };
  }
  return { canSave: true, partsHash: resultPartsHash };
}
