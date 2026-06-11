import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchLinkedCutlistGroups } from '@/lib/cutlist/linkedCutlistGroups';
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
  if (groupBoardType === '32mm-both' || groupBoardType === '32mm-backer') return 32;
  const explicit = Number(part.material_thickness);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 16;
}

type SnapshotGroupSource = {
  id: number;
  name: string;
  board_type: string | null;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: unknown;
};

type MapGroupContext = {
  linePrimary?: CutlistLineMaterial;
  lineBacker?: CutlistLineMaterial;
  lineEdging?: CutlistLineMaterial;
  overrideIndex: Map<string, CutlistPartOverride>;
  pairLookup?: BoardEdgingPairLookup;
  quantityScale: number;
};

function mapGroupToSnapshot(group: SnapshotGroupSource, ctx: MapGroupContext): CutlistSnapshotGroup {
  const primaryMaterialId = ctx.linePrimary?.component_id ?? group.primary_material_id ?? null;
  const primaryMaterialName = ctx.linePrimary?.component_name ?? group.primary_material_name ?? null;
  const backerMaterialId = ctx.lineBacker?.component_id ?? group.backer_material_id ?? null;
  const backerMaterialName = ctx.lineBacker?.component_name ?? group.backer_material_name ?? null;
  const boardType = group.board_type ?? '16mm';
  const sourceParts: any[] = Array.isArray(group.parts) ? group.parts : [];
  const parts: CutlistSnapshotPart[] = sourceParts.map((part: any) => {
    const thickness = thicknessForPart(boardType, part);
    const override = ctx.overrideIndex.get(
      cutlistOverrideKey(boardType, part.name, Number(part.length_mm ?? 0), Number(part.width_mm ?? 0), part.id),
    );
    const effectiveBoardId = override?.board_component_id ?? primaryMaterialId;
    const effectiveBoardName = override?.board_component_name ?? primaryMaterialName;
    const pair = effectiveBoardId != null
      ? ctx.pairLookup?.get(boardEdgingPairKey(effectiveBoardId, thickness))
      : undefined;
    const effectiveEdgingId = override?.edging_component_id ?? ctx.lineEdging?.component_id ?? pair?.component_id ?? null;
    const effectiveEdgingName = override?.edging_component_name ?? ctx.lineEdging?.component_name ?? pair?.component_name ?? null;

    const rawQuantity = Number(part.quantity ?? 0);
    return {
      ...part,
      // Scale-1 path preserves the raw stored value exactly (golden path);
      // the scaled path coerces and guards NaN so legacy string quantities
      // can't poison frozen snapshots.
      quantity: ctx.quantityScale === 1
        ? part.quantity
        : Number.isFinite(rawQuantity) ? rawQuantity * ctx.quantityScale : 0,
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
}

const EMPTY_OVERRIDES = new Map<string, CutlistPartOverride>();

export async function buildCutlistSnapshot(
  productId: number,
  orgId: string,
  options: BuildCutlistSnapshotOptions = {},
  client: SupabaseClient<any, any, any> = supabaseAdmin,
): Promise<{ snapshot: CutlistSnapshotGroup[] | null; groupMap: Map<number, number> }> {
  const { data: groups, error } = await client
    .from('product_cutlist_groups')
    .select(
      'id, name, board_type, primary_material_id, primary_material_name, backer_material_id, backer_material_name, parts'
    )
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .order('sort_order');

  if (error) throw error;

  const ownGroups = (groups ?? []) as SnapshotGroupSource[];

  // groupMap: primary_material_id (component_id) -> cutlist group id.
  // Parent groups only — it links the parent's own BOM rows to its groups.
  const groupMap = new Map<number, number>();
  for (const group of ownGroups) {
    if (group.primary_material_id != null) {
      groupMap.set(group.primary_material_id, group.id);
    }
  }

  const overrideIndex = indexOverrides(options.partOverrides);

  const snapshot: CutlistSnapshotGroup[] = ownGroups.map((group) =>
    mapGroupToSnapshot(group, {
      linePrimary: options.linePrimary,
      lineBacker: options.lineBacker,
      lineEdging: options.lineEdging,
      overrideIndex,
      pairLookup: options.pairLookup,
      quantityScale: 1,
    })
  );

  // Explode linked subcomponents' groups into the snapshot. Child groups keep
  // the CHILD's own materials — line-level material selections and per-part
  // overrides apply to the parent's groups only. Part quantities are
  // multiplied by link_scale here, exactly once.
  const linkedGroups = await fetchLinkedCutlistGroups(client, productId, orgId);
  for (const linked of linkedGroups) {
    snapshot.push({
      ...mapGroupToSnapshot(linked, {
        overrideIndex: EMPTY_OVERRIDES,
        pairLookup: options.pairLookup,
        quantityScale: linked.link_scale,
      }),
      source_sub_product_id: linked.source_sub_product_id,
      source_sub_product_name: linked.source_sub_product_name,
      link_scale: linked.link_scale,
    });
  }

  if (snapshot.length === 0) {
    return { snapshot: null, groupMap };
  }

  return { snapshot, groupMap };
}
