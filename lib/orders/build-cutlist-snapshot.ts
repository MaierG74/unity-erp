import { supabaseAdmin } from '@/lib/supabase-admin';
import { CutlistSnapshotGroup } from './snapshot-types';

export async function buildCutlistSnapshot(
  productId: number,
  orgId: string,
  materialOverrides: Map<number, { component_id: number; name: string }> = new Map()
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

  const snapshot: CutlistSnapshotGroup[] = groups.map((group) => {
    let primaryMaterialId: number | null = group.primary_material_id;
    let primaryMaterialName: string | null = group.primary_material_name;

    if (primaryMaterialId != null && materialOverrides.has(primaryMaterialId)) {
      const override = materialOverrides.get(primaryMaterialId)!;
      primaryMaterialId = override.component_id;
      primaryMaterialName = override.name;
    }

    return {
      source_group_id: group.id,
      name: group.name,
      board_type: group.board_type ?? '16mm',
      primary_material_id: primaryMaterialId,
      primary_material_name: primaryMaterialName,
      backer_material_id: group.backer_material_id ?? null,
      backer_material_name: group.backer_material_name ?? null,
      parts: group.parts ?? [],
    };
  });

  return { snapshot, groupMap };
}
