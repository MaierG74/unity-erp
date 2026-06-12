import type { SupabaseClient } from '@supabase/supabase-js';

import type { DatabaseCutlistGroup } from '@/lib/cutlist/productCutlistLoader';

/**
 * A child product's cutlist group surfaced on its parent, with provenance.
 * Part quantities are NOT yet multiplied by `link_scale` — consumers that
 * bake quantities in (snapshot explosion) multiply exactly once themselves.
 */
export type LinkedCutlistGroup = DatabaseCutlistGroup & {
  source_sub_product_id: number;
  source_sub_product_name: string;
  link_scale: number;
};

type LinkRow = {
  sub_product_id: number | null;
  scale: number | string | null;
};

/**
 * Load the cutlist groups of all subcomponents linked to `productId`,
 * tagged with provenance (sub product id/name + link scale).
 *
 * Works with both the browser client and `supabaseAdmin` — the caller
 * supplies the client. Uses two-step fetches (links, then products /
 * groups via `.in()`) so no PostgREST FK embed hints are needed
 * (`product_bom_links` carries two FKs to `products`).
 */
export async function fetchLinkedCutlistGroups(
  client: SupabaseClient<any, any, any>,
  productId: number,
  orgId: string,
): Promise<LinkedCutlistGroup[]> {
  if (!productId || !Number.isFinite(productId) || !orgId) return [];

  // Only phantom links explode into parent cutlists. Stocked-mode links are
  // defined as NON-exploded (docs/plans/stocked-subassembly-policy-spec-v1.md);
  // when that mode lands, this filter keeps them out of frozen money snapshots.
  const { data: links, error: linksError } = await client
    .from('product_bom_links')
    .select('sub_product_id, scale')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .eq('mode', 'phantom');

  if (linksError) throw linksError;

  const linkRows = (links ?? []) as LinkRow[];
  const scaleBySubId = new Map<number, number>();
  for (const link of linkRows) {
    const subId = Number(link.sub_product_id);
    if (!Number.isFinite(subId) || subId <= 0) continue;
    const scale = Number(link.scale ?? 1);
    scaleBySubId.set(subId, Number.isFinite(scale) && scale > 0 ? scale : 1);
  }

  const subIds = Array.from(scaleBySubId.keys());
  if (subIds.length === 0) return [];

  const [productsRes, groupsRes] = await Promise.all([
    client
      .from('products')
      .select('product_id, name')
      .in('product_id', subIds)
      .eq('org_id', orgId),
    client
      .from('product_cutlist_groups')
      .select('id, product_id, name, board_type, primary_material_id, primary_material_name, backer_material_id, backer_material_name, parts, sort_order')
      .in('product_id', subIds)
      .eq('org_id', orgId)
      .order('product_id', { ascending: true })
      .order('sort_order', { ascending: true }),
  ]);

  if (productsRes.error) throw productsRes.error;
  if (groupsRes.error) throw groupsRes.error;

  const nameBySubId = new Map<number, string>();
  for (const product of (productsRes.data ?? []) as Array<{ product_id: number | null; name: string | null }>) {
    const id = Number(product?.product_id);
    if (Number.isFinite(id)) nameBySubId.set(id, product?.name ?? `Product #${id}`);
  }

  return ((groupsRes.data ?? []) as DatabaseCutlistGroup[]).map((group) => {
    const subProductId = Number(group.product_id);
    return {
      ...group,
      parts: Array.isArray(group.parts) ? group.parts : [],
      source_sub_product_id: subProductId,
      source_sub_product_name: nameBySubId.get(subProductId) ?? `Product #${subProductId}`,
      link_scale: scaleBySubId.get(subProductId) ?? 1,
    };
  });
}
