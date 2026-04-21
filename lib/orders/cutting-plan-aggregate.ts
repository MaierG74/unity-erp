import { roleFingerprint } from './material-assignment-types';
import type { MaterialAssignments } from './material-assignment-types';
import type { AggregatedPart, AggregatedPartGroup } from './cutting-plan-types';

// Shape of the JSONB `cutlist_snapshot` rows persisted on `order_details`.
export type AggregateSnapshotPart = {
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  lamination_config?: unknown;
  material_thickness?: number;
  edging_material_id?: string;
  material_label?: string;
};

export type AggregateSnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: AggregateSnapshotPart[];
};

export type AggregateDetail = {
  order_detail_id: number;
  quantity: number | null;
  cutlist_snapshot: AggregateSnapshotGroup[] | null;
  product_name: string;
};

export type ResolveAggregatedGroupsResult = {
  material_groups: AggregatedPartGroup[];
  total_parts: number;
  has_cutlist_items: boolean;
};

/**
 * Resolve per-role material assignments + order-level backer override into
 * the final grouping shape. Pure function — no I/O.
 *
 * Rules (spec §5):
 *   - Primary: per-role assignment (5-tuple fingerprint) wins; fallback to group's nominal.
 *   - Backer: single order-level override applies only when the group already has a backer.
 *
 * Grouping key: `${board_type}|${resolved_primary_id ?? 'none'}|${resolved_backer_id ?? 'none'}`.
 *
 * Defensive against malformed JSONB: non-array `assignments.assignments` and
 * non-object `assignments.backer_default` are treated as absent.
 */
export function resolveAggregatedGroups(
  details: AggregateDetail[],
  assignments: MaterialAssignments | null,
): ResolveAggregatedGroupsResult {
  // Defensive guards against malformed JSONB.
  const rawAssignments = Array.isArray(assignments?.assignments)
    ? assignments!.assignments
    : [];
  const rawBackerDefault =
    assignments?.backer_default != null &&
    typeof assignments.backer_default === 'object' &&
    typeof (assignments.backer_default as { component_id?: unknown }).component_id === 'number'
      ? assignments.backer_default
      : null;

  // Orphan fingerprints (an assignment that matches no actual part) are benign —
  // they're simply never looked up. Intentional.
  const assignmentIndex = new Map<string, { component_id: number; component_name: string }>();
  for (const a of rawAssignments) {
    const fp = roleFingerprint(a.order_detail_id, a.board_type, a.part_name, a.length_mm, a.width_mm);
    assignmentIndex.set(fp, { component_id: a.component_id, component_name: a.component_name });
  }

  const backerOverride = rawBackerDefault
    ? { component_id: rawBackerDefault.component_id, component_name: rawBackerDefault.component_name }
    : null;

  const groupMap = new Map<string, AggregatedPartGroup>();
  let totalParts = 0;
  let hasCutlistItems = false;

  for (const detail of details) {
    const groups = Array.isArray(detail.cutlist_snapshot) ? detail.cutlist_snapshot : [];
    if (groups.length === 0) continue;
    hasCutlistItems = true;

    const lineQty = detail.quantity ?? 1;

    for (const group of groups) {
      // Per-group backer resolution (hoisted — backer is order-level, not per-role).
      const resolvedBackerId =
        group.backer_material_id != null && backerOverride
          ? backerOverride.component_id
          : group.backer_material_id;
      const resolvedBackerName =
        group.backer_material_id != null && backerOverride
          ? backerOverride.component_name
          : group.backer_material_name;

      for (const part of group.parts) {
        const fp = roleFingerprint(
          detail.order_detail_id,
          group.board_type,
          part.name,
          part.length_mm,
          part.width_mm,
        );
        const assignment = assignmentIndex.get(fp);

        const resolvedPrimaryId = assignment?.component_id ?? group.primary_material_id;
        const resolvedPrimaryName = assignment?.component_name ?? group.primary_material_name;

        const key = `${group.board_type}|${resolvedPrimaryId ?? 'none'}|${resolvedBackerId ?? 'none'}`;

        let target = groupMap.get(key);
        if (!target) {
          target = {
            board_type: group.board_type,
            primary_material_id: resolvedPrimaryId,
            primary_material_name: resolvedPrimaryName,
            backer_material_id: resolvedBackerId,
            backer_material_name: resolvedBackerName,
            parts: [],
          };
          groupMap.set(key, target);
        }

        const aggregatedPart: AggregatedPart = {
          id: `${detail.order_detail_id}-${part.id}`,
          original_id: part.id,
          order_detail_id: detail.order_detail_id,
          product_name: detail.product_name,
          name: part.name,
          grain: part.grain,
          quantity: part.quantity * lineQty,
          width_mm: part.width_mm,
          length_mm: part.length_mm,
          band_edges: part.band_edges,
          lamination_type: part.lamination_type,
          lamination_config: part.lamination_config,
          material_thickness: part.material_thickness,
          edging_material_id: part.edging_material_id,
          material_label: part.material_label,
        };
        target.parts.push(aggregatedPart);
        totalParts++;
      }
    }
  }

  return {
    material_groups: Array.from(groupMap.values()),
    total_parts: totalParts,
    has_cutlist_items: hasCutlistItems,
  };
}
