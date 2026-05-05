import type { AggregateResponse, AggregatedPart, AggregatedPartGroup } from '@/lib/orders/cutting-plan-types';
import type { MaterialAssignments } from '@/lib/orders/material-assignment-types';
import { findAssignment } from '@/lib/orders/material-assignment-types';
import type { BackerLookupEntry } from '@/lib/orders/cutting-plan-aggregate';

const ZERO_BAND_EDGES = { top: false, right: false, bottom: false, left: false };

function pushPart(
  map: Map<string, AggregatedPartGroup>,
  key: string,
  group: Omit<AggregatedPartGroup, 'parts'>,
  part: AggregatedPart,
) {
  let target = map.get(key);
  if (!target) {
    target = { ...group, parts: [] };
    map.set(key, target);
  }
  target.parts.push(part);
}

/**
 * Re-group aggregated parts by the current assigned material.
 *
 * The aggregate endpoint already returns the v2 shape, but the builder calls
 * this after flushing staged assignments so the packer always sees the
 * post-flush material choices.
 */
export function regroupByAssignedMaterial(
  agg: AggregateResponse,
  materialAssignments: MaterialAssignments,
  backerLookup: Map<number, BackerLookupEntry>,
): AggregatedPartGroup[] | null {
  const groupMap = new Map<string, AggregatedPartGroup>();

  for (const group of agg.material_groups) {
    if (group.kind !== 'primary') continue;

    for (const part of group.parts) {
      const match = findAssignment(
        materialAssignments.assignments,
        part.order_detail_id,
        part.source_board_type,
        part.name,
        part.length_mm,
        part.width_mm,
      );

      const componentId = part.effective_board_id ?? match?.component_id ?? group.material_id ?? null;
      const componentName = part.effective_board_name ?? match?.component_name ?? group.material_name ?? null;
      if (componentId == null) return null;

      pushPart(
        groupMap,
        `primary|${group.sheet_thickness_mm}|${componentId}`,
        {
          kind: 'primary',
          sheet_thickness_mm: group.sheet_thickness_mm,
          material_id: componentId,
          material_name: componentName ?? `Material ${componentId}`,
        },
        part,
      );

      if (!part.source_board_type.endsWith('-backer')) continue;

      const backerId = materialAssignments.backer_default?.component_id ?? part.effective_backer_id ?? null;
      const backerName = materialAssignments.backer_default?.component_name ?? part.effective_backer_name ?? null;
      if (backerId == null) return null;

      const backer = backerLookup.get(backerId);
      if (!backer) return null;

      pushPart(
        groupMap,
        `backer|${backer.thickness_mm}|${backerId}`,
        {
          kind: 'backer',
          sheet_thickness_mm: backer.thickness_mm,
          material_id: backerId,
          material_name: backerName ?? backer.component_name ?? `Backer ${backerId}`,
        },
        {
          ...part,
          id: `${part.id}::backer`,
          band_edges: ZERO_BAND_EDGES,
          edging_material_id: undefined,
          effective_edging_id: null,
          effective_edging_name: null,
        },
      );
    }
  }

  return Array.from(groupMap.values());
}
