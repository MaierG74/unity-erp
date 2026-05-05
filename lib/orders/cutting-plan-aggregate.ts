import { roleFingerprint } from './material-assignment-types';
import type { MaterialAssignments } from './material-assignment-types';
import { parseSheetThickness } from '@/lib/cutlist/boardCalculator';
import type {
  AggregatedPart,
  AggregatedPartGroup,
  BackerThicknessInvalidEntry,
} from './cutting-plan-types';

// Shape of the JSONB `cutlist_material_snapshot` rows persisted on `order_details`.
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
  effective_board_id?: number | null;
  effective_board_name?: string | null;
  effective_thickness_mm?: number | null;
  effective_edging_id?: number | null;
  effective_edging_name?: string | null;
  is_overridden?: boolean;
};

export type AggregateSnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  effective_backer_id?: number | null;
  effective_backer_name?: string | null;
  parts: AggregateSnapshotPart[];
};

export type AggregateDetail = {
  order_detail_id: number;
  quantity: number | null;
  cutlist_material_snapshot: AggregateSnapshotGroup[] | null;
  product_name: string;
};

export type ResolveAggregatedGroupsResult = {
  ok: true;
  material_groups: AggregatedPartGroup[];
  total_parts: number;
  has_cutlist_items: boolean;
} | {
  ok: false;
  error: 'BACKER_THICKNESS_INVALID';
  invalid: BackerThicknessInvalidEntry[];
};

export type BackerLookupEntry = {
  thickness_mm: number;
  category_id: number;
  component_name?: string | null;
};

const ZERO_BAND_EDGES = { top: false, right: false, bottom: false, left: false };

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
  backerLookup: Map<number, BackerLookupEntry> = new Map(),
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
  const invalidBackers = new Map<number, BackerThicknessInvalidEntry>();
  let totalParts = 0;
  let hasCutlistItems = false;

  const pushPart = (
    key: string,
    groupInit: Omit<AggregatedPartGroup, 'parts'>,
    part: AggregatedPart,
  ) => {
    let target = groupMap.get(key);
    if (!target) {
      target = { ...groupInit, parts: [] };
      groupMap.set(key, target);
    }
    target.parts.push(part);
  };

  for (const detail of details) {
    const groups = Array.isArray(detail.cutlist_material_snapshot) ? detail.cutlist_material_snapshot : [];
    if (groups.length === 0) continue;
    hasCutlistItems = true;

    const lineQty = detail.quantity ?? 1;

    for (const group of groups) {
      // Per-group backer resolution (hoisted — backer is order-level, not per-role).
      const resolvedBackerId =
        group.effective_backer_id ?? (group.backer_material_id != null && backerOverride
          ? backerOverride.component_id
          : group.backer_material_id);
      const resolvedBackerName =
        group.effective_backer_name ?? (group.backer_material_id != null && backerOverride
          ? backerOverride.component_name
          : group.backer_material_name);

      for (const part of group.parts) {
        if (part.quantity <= 0) continue;

        const fp = roleFingerprint(
          detail.order_detail_id,
          group.board_type,
          part.name,
          part.length_mm,
          part.width_mm,
        );
        const assignment = assignmentIndex.get(fp);

        const resolvedPrimaryId = part.effective_board_id ?? assignment?.component_id ?? group.primary_material_id;
        const resolvedPrimaryName = part.effective_board_name ?? assignment?.component_name ?? group.primary_material_name;

        const aggregatedPart: AggregatedPart = {
          id: `${detail.order_detail_id}-${part.id}`,
          original_id: part.id,
          order_detail_id: detail.order_detail_id,
          product_name: detail.product_name,
          source_board_type: group.board_type,
          name: part.name,
          grain: part.grain,
          quantity: part.quantity * lineQty,
          width_mm: part.width_mm,
          length_mm: part.length_mm,
          band_edges: part.band_edges,
          lamination_type: part.lamination_type,
          lamination_config: part.lamination_config,
          material_thickness: part.material_thickness,
          edging_material_id: part.effective_edging_id != null ? String(part.effective_edging_id) : part.edging_material_id,
          material_label: part.material_label,
          effective_board_id: part.effective_board_id,
          effective_board_name: part.effective_board_name,
          effective_thickness_mm: part.effective_thickness_mm,
          effective_edging_id: part.effective_edging_id,
          effective_edging_name: part.effective_edging_name,
          effective_backer_id: resolvedBackerId,
          effective_backer_name: resolvedBackerName,
          is_overridden: part.is_overridden,
        };
        if (resolvedPrimaryId != null) {
          const sheetThickness = parseSheetThickness(group.board_type);
          pushPart(
            `primary|${sheetThickness}|${resolvedPrimaryId}`,
            {
              kind: 'primary',
              sheet_thickness_mm: sheetThickness,
              material_id: resolvedPrimaryId,
              material_name: resolvedPrimaryName ?? `Material ${resolvedPrimaryId}`,
            },
            aggregatedPart,
          );
        }

        if (group.board_type.endsWith('-backer')) {
          if (resolvedBackerId == null) {
            // Keep the historical "missing assignment" contract: no backer id means
            // the client cannot generate yet, but the aggregate can still load.
          } else {
            const backer = backerLookup.get(resolvedBackerId);
            if (!backer) {
              invalidBackers.set(resolvedBackerId, {
                component_id: resolvedBackerId,
                parsed_value: null,
                reason: 'null',
              });
            } else {
              pushPart(
                `backer|${backer.thickness_mm}|${resolvedBackerId}`,
                {
                  kind: 'backer',
                  sheet_thickness_mm: backer.thickness_mm,
                  material_id: resolvedBackerId,
                  material_name:
                    resolvedBackerName ?? backer.component_name ?? `Backer ${resolvedBackerId}`,
                },
                {
                  ...aggregatedPart,
                  id: `${aggregatedPart.id}::backer`,
                  band_edges: ZERO_BAND_EDGES,
                  edging_material_id: undefined,
                  effective_edging_id: null,
                  effective_edging_name: null,
                },
              );
            }
          }
        }
        totalParts++;
      }
    }
  }

  if (invalidBackers.size > 0) {
    return {
      ok: false,
      error: 'BACKER_THICKNESS_INVALID',
      invalid: Array.from(invalidBackers.values()),
    };
  }

  return {
    ok: true,
    material_groups: Array.from(groupMap.values()),
    total_parts: totalParts,
    has_cutlist_items: hasCutlistItems,
  };
}
