import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export interface OptionSetValue {
  option_set_value_id: number;
  option_set_group_id?: number;
  code: string;
  label: string;
  is_default: boolean;
  display_order: number;
  attributes: Record<string, unknown> | null;
  default_component_id: number | null;
  default_supplier_component_id: number | null;
  default_quantity_delta: number | null;
  default_notes: string | null;
  default_is_cutlist: boolean | null;
  default_cutlist_category: string | null;
  default_cutlist_dimensions: Record<string, unknown> | null;
}

export interface OptionSetGroup {
  option_set_group_id: number;
  code: string;
  label: string;
  is_required: boolean;
  display_order: number;
  values: OptionSetValue[];
}

export interface OptionSet {
  option_set_id: number;
  code: string;
  name: string;
  description: string | null;
  usage_count: number;
  created_at?: string;
  updated_at?: string;
  groups: OptionSetGroup[];
}

export async function fetchOptionSets(): Promise<OptionSet[]> {
  const res = await fetch('/api/option-sets', { cache: 'no-store' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to load option sets');
  }
  const json = await res.json();
  return Array.isArray(json.sets) ? (json.sets as OptionSet[]) : [];
}

export function useOptionSets(): UseQueryResult<OptionSet[], Error> {
  return useQuery({
    queryKey: ['optionSets'],
    queryFn: fetchOptionSets,
  });
}

export interface ProductOptionGroupOverlay {
  option_set_group_id: number;
  alias_label: string | null;
  is_required: boolean | null;
  hide: boolean;
  display_order: number | null;
}

export interface ProductOptionValueOverlay {
  option_set_value_id: number;
  alias_label: string | null;
  is_default: boolean | null;
  hide: boolean;
  display_order: number | null;
}

export interface ProductOptionSetLink {
  link_id: number;
  product_id: number;
  option_set_id: number;
  display_order: number;
  alias_label: string | null;
  option_set: OptionSet | null;
  group_overlays: ProductOptionGroupOverlay[];
  value_overlays: ProductOptionValueOverlay[];
}

export async function fetchProductOptionSetLinks(productId: number): Promise<ProductOptionSetLink[]> {
  const res = await fetch(`/api/products/${productId}/option-sets`, { cache: 'no-store' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to load product option sets');
  }
  const json = await res.json();
  return Array.isArray(json.links) ? (json.links as ProductOptionSetLink[]) : [];
}

export function useProductOptionSetLinks(productId: number): UseQueryResult<ProductOptionSetLink[], Error> {
  return useQuery({
    queryKey: ['productOptionSets', productId],
    queryFn: () => fetchProductOptionSetLinks(productId),
    enabled: Number.isFinite(productId) && productId > 0,
  });
}
