import type { AggregatedPartGroup } from '@/lib/orders/cutting-plan-types';
import type {
  MaterialAssignments,
} from '@/lib/orders/material-assignment-types';
import { roleFingerprint } from '@/lib/orders/material-assignment-types';
import type { CuttingPlanEdgingEntry, CuttingPlanOverride } from '@/lib/orders/cutting-plan-types';

type EdgingResult = {
  /** Per-material-group edging entries (for edging_by_material on each group) */
  groupEdging: Map<string, CuttingPlanEdgingEntry[]>;
  /** Aggregated edging overrides for component_overrides */
  edgingOverrides: CuttingPlanOverride[];
};

/**
 * Resolve which edging component a part should use.
 * Priority: edging_overrides (per-part) > edging_defaults (per-board) > null.
 */
function resolveEdgingForPart(
  orderDetailId: number,
  boardType: string,
  partName: string,
  lengthMm: number,
  widthMm: number,
  assignedBoardComponentId: number,
  effectiveEdgingId: number | null | undefined,
  effectiveEdgingName: string | null | undefined,
  assignments: MaterialAssignments,
): { edging_component_id: number; edging_component_name: string } | null {
  if (effectiveEdgingId != null) {
    return {
      edging_component_id: effectiveEdgingId,
      edging_component_name: effectiveEdgingName ?? `Edging ${effectiveEdgingId}`,
    };
  }
  const fp = roleFingerprint(orderDetailId, boardType, partName, lengthMm, widthMm);
  const override = assignments.edging_overrides.find(
    (eo) => roleFingerprint(eo.order_detail_id, eo.board_type, eo.part_name, eo.length_mm, eo.width_mm) === fp,
  );
  if (override) {
    return {
      edging_component_id: override.edging_component_id,
      edging_component_name: override.edging_component_name,
    };
  }

  const boardDefault = assignments.edging_defaults.find(
    (ed) => ed.board_component_id === assignedBoardComponentId,
  );
  if (boardDefault) {
    return {
      edging_component_id: boardDefault.edging_component_id,
      edging_component_name: boardDefault.edging_component_name,
    };
  }

  return null;
}

/**
 * Compute edging lengths per edging component from regrouped material groups.
 *
 * Axis convention: top/bottom edges span part.width_mm (short edges);
 * left/right edges span part.length_mm (long edges). Total is × quantity.
 *
 * Returns null if any part with edges is missing an edging assignment.
 */
export function computeEdging(
  regroupedGroups: AggregatedPartGroup[],
  assignments: MaterialAssignments,
): EdgingResult | null {
  const groupEdgingMap = new Map<
    string,
    Map<number, { name: string; length_mm: number }>
  >();

  const globalTotals = new Map<number, { name: string; length_mm: number }>();

  for (const group of regroupedGroups) {
    const groupKey = `${group.kind}|${group.sheet_thickness_mm}|${group.material_id}`;

    if (!groupEdgingMap.has(groupKey)) {
      groupEdgingMap.set(groupKey, new Map());
    }
    if (group.kind === 'backer') continue;
    const groupAcc = groupEdgingMap.get(groupKey)!;

    for (const part of group.parts) {
      const edges = part.band_edges;
      if (!edges) continue;

      const hasAnyEdge = edges.top || edges.bottom || edges.left || edges.right;
      if (!hasAnyEdge) continue;

      let edgingLength = 0;
      if (edges.top) edgingLength += part.width_mm * part.quantity;
      if (edges.bottom) edgingLength += part.width_mm * part.quantity;
      if (edges.left) edgingLength += part.length_mm * part.quantity;
      if (edges.right) edgingLength += part.length_mm * part.quantity;

      if (edgingLength === 0) continue;

      const resolved = resolveEdgingForPart(
        part.order_detail_id,
        part.source_board_type,
        part.name,
        part.length_mm,
        part.width_mm,
        group.material_id,
        part.effective_edging_id,
        part.effective_edging_name,
        assignments,
      );
      if (!resolved) return null;

      const existing = groupAcc.get(resolved.edging_component_id);
      if (existing) {
        existing.length_mm += edgingLength;
      } else {
        groupAcc.set(resolved.edging_component_id, {
          name: resolved.edging_component_name,
          length_mm: edgingLength,
        });
      }

      const globalExisting = globalTotals.get(resolved.edging_component_id);
      if (globalExisting) {
        globalExisting.length_mm += edgingLength;
      } else {
        globalTotals.set(resolved.edging_component_id, {
          name: resolved.edging_component_name,
          length_mm: edgingLength,
        });
      }
    }
  }

  const groupEdging = new Map<string, CuttingPlanEdgingEntry[]>();
  for (const [groupKey, acc] of groupEdgingMap) {
    const entries: CuttingPlanEdgingEntry[] = Array.from(acc.entries()).map(
      ([componentId, { name, length_mm }]) => ({
        component_id: componentId,
        component_name: name,
        thickness_mm: 0,
        length_mm: Math.round(length_mm),
        unit: 'mm' as const,
      }),
    );
    groupEdging.set(groupKey, entries);
  }

  const edgingOverrides: CuttingPlanOverride[] = Array.from(
    globalTotals.entries(),
  ).map(([componentId, { length_mm }]) => ({
    component_id: componentId,
    // Edging is sold and purchased by the meter; convert from the mm
    // accumulator so downstream purchasing demand is in the right unit.
    quantity: Math.round(length_mm) / 1000,
    unit: 'm' as const,
    source: 'cutlist_edging' as const,
  }));

  return { groupEdging, edgingOverrides };
}
