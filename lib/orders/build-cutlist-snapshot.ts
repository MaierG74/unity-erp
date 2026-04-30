import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  boardEdgingPairKey,
  cutlistOverrideKey,
  type BoardEdgingPairLookup,
  type CutlistLineMaterial,
  type CutlistPartOverride,
  type CutlistSnapshotGroup,
  type CutlistSnapshotPart,
} from './snapshot-types';

type BuildCutlistSnapshotOptions = {
  linePrimary?: CutlistLineMaterial;
  lineBacker?: CutlistLineMaterial;
  lineEdging?: CutlistLineMaterial;
  partOverrides?: CutlistPartOverride[];
  pairLookup?: BoardEdgingPairLookup;
};

function indexOverrides(overrides: CutlistPartOverride[] = []): Map<string, CutlistPartOverride> {
  const index = new Map<string, CutlistPartOverride>();
  for (const override of overrides) {
    if (!override.board_type || !override.part_name) continue;
    index.set(
      cutlistOverrideKey(
        override.board_type,
        override.part_name,
        Number(override.length_mm ?? 0),
        Number(override.width_mm ?? 0),
        override.part_id ?? null,
      ),
      override,
    );
  }
  return index;
}

function thicknessForPart(groupBoardType: string, part: { material_thickness?: unknown; lamination_type?: unknown }): number | null {
  const explicit = Number(part.material_thickness);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (groupBoardType === '32mm-both' || groupBoardType === '32mm-backer') return 32;
  return 16;
}

export async function buildCutlistSnapshot(
  productId: number,
  orgId: string,
  options: BuildCutlistSnapshotOptions = {},
): Promise<{ snapshot: CutlistSnapshotGroup[] | null; groupMap: Map<number, number> }> {
  const { data: groups, error } = await supabaseAdmin
    .from('product_cutlist_groups')
    .select(
      'id, name, board_type, primary_material_id, primary_material_name, backer_material_id, backer_material_name, parts'
    )
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .order('sort_order');

  if (error) throw error;

  if (!groups || groups.length === 0) {
    return { snapshot: null, groupMap: new Map() };
  }

  // groupMap: primary_material_id (component_id) -> cutlist group id
  const groupMap = new Map<number, number>();
  for (const group of groups) {
    if (group.primary_material_id != null) {
      groupMap.set(group.primary_material_id, group.id);
    }
  }

  const overrideIndex = indexOverrides(options.partOverrides);

  const snapshot: CutlistSnapshotGroup[] = groups.map((group) => {
    const primaryMaterialId = options.linePrimary?.component_id ?? group.primary_material_id ?? null;
    const primaryMaterialName = options.linePrimary?.component_name ?? group.primary_material_name ?? null;
    const backerMaterialId = options.lineBacker?.component_id ?? group.backer_material_id ?? null;
    const backerMaterialName = options.lineBacker?.component_name ?? group.backer_material_name ?? null;
    const boardType = group.board_type ?? '16mm';
    const parts: CutlistSnapshotPart[] = (group.parts ?? []).map((part: any) => {
      const thickness = thicknessForPart(boardType, part);
      const override = overrideIndex.get(
        cutlistOverrideKey(boardType, part.name, Number(part.length_mm ?? 0), Number(part.width_mm ?? 0), part.id),
      );
      const effectiveBoardId = override?.board_component_id ?? primaryMaterialId;
      const effectiveBoardName = override?.board_component_name ?? primaryMaterialName;
      const pair = effectiveBoardId != null
        ? options.pairLookup?.get(boardEdgingPairKey(effectiveBoardId, thickness))
        : undefined;
      const effectiveEdgingId = override?.edging_component_id ?? options.lineEdging?.component_id ?? pair?.component_id ?? null;
      const effectiveEdgingName = override?.edging_component_name ?? options.lineEdging?.component_name ?? pair?.component_name ?? null;

      return {
        ...part,
        effective_board_id: effectiveBoardId,
        effective_board_name: effectiveBoardName,
        effective_thickness_mm: thickness,
        effective_edging_id: effectiveEdgingId,
        effective_edging_name: effectiveEdgingName,
        is_overridden: Boolean(override?.board_component_id != null || override?.edging_component_id != null),
      };
    });
    return {
      source_group_id: group.id,
      name: group.name,
      board_type: boardType,
      primary_material_id: primaryMaterialId,
      primary_material_name: primaryMaterialName,
      backer_material_id: backerMaterialId,
      backer_material_name: backerMaterialName,
      effective_backer_id: backerMaterialId,
      effective_backer_name: backerMaterialName,
      parts,
    };
  });

  return { snapshot, groupMap };
}
