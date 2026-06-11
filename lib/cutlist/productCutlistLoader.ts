import { authorizedFetch } from '@/lib/client/auth-fetch';
import type { LinkedCutlistGroup } from '@/lib/cutlist/linkedCutlistGroups';
import { MODULE_KEYS } from '@/lib/modules/keys';

export interface DatabaseCutlistGroup {
  id: number;
  product_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: Array<{
    id: string;
    name: string;
    length_mm: number;
    width_mm: number;
    quantity: number;
    grain: 'length' | 'width' | 'any';
    band_edges: { top: boolean; right: boolean; bottom: boolean; left: boolean };
    material_label?: string;
    lamination_type?: 'same-board' | 'counter-balance' | 'veneer' | 'with-backer' | 'none' | 'custom';
  }>;
  sort_order: number;
}

export interface EffectiveBomItem {
  bom_id?: number | null;
  component_id: number;
  quantity_required: number;
  supplier_component_id?: number | null;
  suppliercomponents?: { price?: number } | null;
  _source?: 'direct' | 'link' | 'rpc';
  _sub_product_id?: number | null;
  _editable?: boolean;
  component_description?: string | null;
  is_cutlist_item?: boolean | null;
  cutlist_category?: string | null;
  cutlist_dimensions?: Record<string, unknown> | null;
}

export type CutlistDataSource = 'groups' | 'bom' | 'empty';

export interface ProductCutlistData {
  source: CutlistDataSource;
  groups: DatabaseCutlistGroup[];
  bomItems: EffectiveBomItem[];
  /** Cutlist groups from linked subcomponents — rendered read-only, never merged into `groups`. */
  linkedGroups: LinkedCutlistGroup[];
}

export async function loadProductCutlistData(
  productId: number
): Promise<ProductCutlistData> {
  if (!productId || !Number.isFinite(productId)) {
    return { source: 'empty', groups: [], bomItems: [], linkedGroups: [] };
  }

  const groupsRes = await authorizedFetch(
    `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}&include_linked=1`
  );
  if (!groupsRes.ok) {
    throw new Error('Failed to load product cutlist groups');
  }
  const groupsJson = (await groupsRes.json()) as {
    groups?: DatabaseCutlistGroup[];
    linkedGroups?: LinkedCutlistGroup[];
  };
  const groups = Array.isArray(groupsJson?.groups) ? groupsJson.groups : [];
  const linkedGroups = Array.isArray(groupsJson?.linkedGroups) ? groupsJson.linkedGroups : [];

  if (groups.length > 0) {
    return { source: 'groups', groups, bomItems: [], linkedGroups };
  }

  const bomRes = await authorizedFetch(`/api/products/${productId}/effective-bom`);
  if (!bomRes.ok) {
    throw new Error('Failed to load effective BOM');
  }
  const bomJson = (await bomRes.json()) as { items?: EffectiveBomItem[] };
  const allBomItems = Array.isArray(bomJson?.items) ? bomJson.items : [];

  // When subcomponent cutlist groups were returned, their material already
  // arrives via linkedGroups — keeping the link-sourced BOM rows as well
  // would double-count child material.
  const bomItems = linkedGroups.length > 0
    ? allBomItems.filter((item) => item._source !== 'link')
    : allBomItems;

  const cutlistItems = bomItems.filter((item) => {
    const hasFlag = Boolean(item.is_cutlist_item);
    const hasDims =
      item.cutlist_dimensions && Object.keys(item.cutlist_dimensions).length > 0;
    return hasFlag || hasDims;
  });

  if (cutlistItems.length > 0) {
    return { source: 'bom', groups: [], bomItems, linkedGroups };
  }

  // A parent that is purely an assembly of subcomponents still has a cutlist
  // to show — surface it via linkedGroups instead of falling through to empty.
  if (linkedGroups.length > 0) {
    return { source: 'groups', groups: [], bomItems: [], linkedGroups };
  }

  return { source: 'empty', groups: [], bomItems: [], linkedGroups: [] };
}
