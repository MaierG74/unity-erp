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
  assignments: MaterialAssignments,
): { edging_component_id: number; edging_component_name: string } | null {
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
 * For each part with band_edges, calculates total edging length from
 * top/bottom (part.length_mm) and left/right (part.width_mm) × quantity.
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
    const groupKey = `${group.board_type}|${group.primary_material_id}|${group.backer_material_id ?? 'none'}`;

    if (!groupEdgingMap.has(groupKey)) {
      groupEdgingMap.set(groupKey, new Map());
    }
    const groupAcc = groupEdgingMap.get(groupKey)!;

    for (const part of group.parts) {
      const edges = part.band_edges;
      if (!edges) continue;

      const hasAnyEdge = edges.top || edges.bottom || edges.left || edges.right;
      if (!hasAnyEdge) continue;

      let edgingLength = 0;
      if (edges.top) edgingLength += part.length_mm * part.quantity;
      if (edges.bottom) edgingLength += part.length_mm * part.quantity;
      if (edges.left) edgingLength += part.width_mm * part.quantity;
      if (edges.right) edgingLength += part.width_mm * part.quantity;

      if (edgingLength === 0) continue;

      if (group.primary_material_id == null) return null;
      const resolved = resolveEdgingForPart(
        part.order_detail_id,
        group.board_type,
        part.name,
        part.length_mm,
        part.width_mm,
        group.primary_material_id,
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
    quantity: Math.round(length_mm),
    unit: 'mm' as const,
    source: 'cutlist_edging' as const,
  }));

  return { groupEdging, edgingOverrides };
}
