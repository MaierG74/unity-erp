import type { AggregateResponse, AggregatedPartGroup } from '@/lib/orders/cutting-plan-types';
import type { MaterialAssignments } from '@/lib/orders/material-assignment-types';
import { findAssignment } from '@/lib/orders/material-assignment-types';

/**
 * Re-group aggregated parts by their assigned material.
 *
 * The aggregate endpoint groups by snapshot material. After the user assigns
 * specific materials per part role, this function flattens all parts and
 * re-groups them by the assigned material so the packer processes correct groups.
 *
 * Returns null if any part is missing an assignment or if a -backer group
 * has no backer_default resolved.
 */
export function regroupByAssignedMaterial(
  agg: AggregateResponse,
  materialAssignments: MaterialAssignments,
): AggregatedPartGroup[] | null {
  const groupMap = new Map<string, AggregatedPartGroup>();

  for (const group of agg.material_groups) {
    const hasBacker = group.board_type.includes('-backer');

    // Resolve backer: prefer user's backer_default, fall back to snapshot
    let backerId: number | null = null;
    let backerName: string | null = null;
    if (hasBacker) {
      if (materialAssignments.backer_default) {
        backerId = materialAssignments.backer_default.component_id;
        backerName = materialAssignments.backer_default.component_name;
      } else if (group.backer_material_id) {
        // Preserve snapshot backer if no explicit override
        backerId = group.backer_material_id;
        backerName = group.backer_material_name;
      } else {
        return null; // -backer group with no backer resolved
      }
    }

    for (const part of group.parts) {
      const match = findAssignment(
        materialAssignments.assignments,
        part.order_detail_id,
        group.board_type,
        part.name,
        part.length_mm,
        part.width_mm,
      );

      if (!match) return null; // Missing assignment

      const key = `${group.board_type}|${match.component_id}|${backerId ?? 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          board_type: group.board_type,
          primary_material_id: match.component_id,
          primary_material_name: match.component_name,
          backer_material_id: backerId,
          backer_material_name: backerName,
          parts: [],
        });
      }

      groupMap.get(key)!.parts.push(part);
    }
  }

  return Array.from(groupMap.values());
}
