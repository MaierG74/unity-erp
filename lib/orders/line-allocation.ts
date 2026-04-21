import type { CuttingPlanLineAllocation } from './cutting-plan-types';
import { round2, safeNonNegativeFinite } from './cutting-plan-utils';

export type LineAllocationInput = {
  order_detail_id: number;
  /** Sum of (length_mm × width_mm × quantity) for this line's cutlist parts. */
  area_mm2: number;
};

/**
 * Allocate total nested cost across lines proportionally to each line's
 * cutlist part area (mm²). Spec §4.
 *
 * Rationale: area reflects physical material consumption and is invariant
 * under per-line material substitutions (5 white + 5 cherry cupboards with
 * the same geometry allocate 50/50 regardless of cost difference). The
 * cross-product nesting *savings* are distributed by how much space each
 * line contributed to the nested layout.
 *
 * Special cases:
 *   - Empty input → empty output.
 *   - Zero-area lines (non-cutlist-only) are excluded from the allocation:
 *     they receive line_share_amount = 0 and allocation_pct = 0. Their
 *     non-cutlist BOM cost is layered on separately by pickLineMaterialCost.
 *   - All-zero input → all-zero output (defensive; don't divide by zero).
 *   - Rounding error is absorbed by the last non-zero-area line so the shares
 *     sum to total_nested_cost at 2dp (the precision at which we round each
 *     share). Raw FP summation of the returned numbers may still drift at
 *     sub-cent precision — callers should round when comparing.
 */
export function allocateLinesByArea(
  lines: LineAllocationInput[],
  total_nested_cost: number,
): CuttingPlanLineAllocation[] {
  if (lines.length === 0) return [];

  const sumArea = lines.reduce((s, l) => s + safeNonNegativeFinite(l.area_mm2), 0);

  // Defensive all-zero: return zero shares (not even split — if there are no
  // cutlist parts anywhere there should be no nested cost to allocate).
  if (sumArea === 0) {
    return lines.map((l) => ({
      order_detail_id: l.order_detail_id,
      area_mm2: 0,
      line_share_amount: 0,
      allocation_pct: 0,
    }));
  }

  // Identify the last non-zero-area line — rounding error absorbed there
  let lastNonZeroIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].area_mm2 > 0) { lastNonZeroIdx = i; break; }
  }

  const out: CuttingPlanLineAllocation[] = [];
  let allocatedSoFar = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const area = safeNonNegativeFinite(l.area_mm2);

    if (area === 0) {
      out.push({
        order_detail_id: l.order_detail_id,
        area_mm2: 0,
        line_share_amount: 0,
        allocation_pct: 0,
      });
      continue;
    }

    const pct = (area / sumArea) * 100;
    const share = i === lastNonZeroIdx
      ? total_nested_cost - allocatedSoFar
      : (area / sumArea) * total_nested_cost;
    const rounded = round2(share);
    allocatedSoFar += rounded;

    out.push({
      order_detail_id: l.order_detail_id,
      area_mm2: area,
      line_share_amount: rounded,
      allocation_pct: round2(pct),
    });
  }
  return out;
}
