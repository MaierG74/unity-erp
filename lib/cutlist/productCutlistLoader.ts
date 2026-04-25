import { authorizedFetch } from '@/lib/client/auth-fetch';
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
}

export async function loadProductCutlistData(
  productId: number
): Promise<ProductCutlistData> {
  if (!productId || !Number.isFinite(productId)) {
    return { source: 'empty', groups: [], bomItems: [] };
  }

  const groupsRes = await authorizedFetch(
    `/api/products/${productId}/cutlist-groups?module=${MODULE_KEYS.CUTLIST_OPTIMIZER}`
  );
  if (!groupsRes.ok) {
    throw new Error('Failed to load product cutlist groups');
  }
  const groupsJson = (await groupsRes.json()) as { groups?: DatabaseCutlistGroup[] };
  const groups = Array.isArray(groupsJson?.groups) ? groupsJson.groups : [];

  if (groups.length > 0) {
    return { source: 'groups', groups, bomItems: [] };
  }

  const bomRes = await authorizedFetch(`/api/products/${productId}/effective-bom`);
  if (!bomRes.ok) {
    throw new Error('Failed to load effective BOM');
  }
  const bomJson = (await bomRes.json()) as { items?: EffectiveBomItem[] };
  const bomItems = Array.isArray(bomJson?.items) ? bomJson.items : [];

  const cutlistItems = bomItems.filter((item) => {
    const hasFlag = Boolean(item.is_cutlist_item);
    const hasDims =
      item.cutlist_dimensions && Object.keys(item.cutlist_dimensions).length > 0;
    return hasFlag || hasDims;
  });

  if (cutlistItems.length > 0) {
    return { source: 'bom', groups: [], bomItems };
  }

  return { source: 'empty', groups: [], bomItems: [] };
}
