export interface OptionSetValue {
  option_set_value_id: number;
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
  display_order: number;
  is_required: boolean;
  values: OptionSetValue[];
}

export interface OptionSetSummary {
  option_set_id: number;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  usage_count: number;
  groups: OptionSetGroup[];
}

export async function fetchOptionSets(): Promise<OptionSetSummary[]> {
  const res = await fetch('/api/option-sets', { cache: 'no-store' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to load option sets');
  }
  const json = await res.json();
  return Array.isArray(json.sets) ? json.sets : [];
}

export async function createOptionSet(payload: { code: string; name: string; description?: string | null }): Promise<OptionSetSummary> {
  const res = await fetch('/api/option-sets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to create option set');
  }
  const json = await res.json();
  return json.option_set as OptionSetSummary;
}

export async function updateOptionSet(optionSetId: number, payload: { code?: string; name?: string; description?: string | null }) {
  const res = await fetch(`/api/option-sets/${optionSetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to update option set');
  }
  const json = await res.json();
  return json.option_set as OptionSetSummary;
}

export async function deleteOptionSet(optionSetId: number): Promise<void> {
  const res = await fetch(`/api/option-sets/${optionSetId}`, { method: 'DELETE' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to delete option set');
  }
}

export interface ProductOptionSetLink {
  link_id: number;
  product_id: number;
  option_set_id: number;
  display_order: number;
  alias_label: string | null;
  option_set: OptionSetSummary | null;
}

export async function fetchProductOptionSetLinks(productId: number): Promise<ProductOptionSetLink[]> {
  const res = await fetch(`/api/products/${productId}/option-sets`, { cache: 'no-store' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to load product option sets');
  }
  const json = await res.json();
  return Array.isArray(json.links) ? json.links : [];
}

export async function attachOptionSetToProduct(productId: number, optionSetId: number, aliasLabel?: string | null): Promise<ProductOptionSetLink> {
  const res = await fetch(`/api/products/${productId}/option-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ option_set_id: optionSetId, alias_label: aliasLabel ?? null }),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to attach option set');
  }
  const json = await res.json();
  return json.link as ProductOptionSetLink;
}

export async function updateProductOptionSetLink(
  productId: number,
  linkId: number,
  payload: { alias_label?: string | null; display_order?: number }
): Promise<void> {
  const res = await fetch(`/api/products/${productId}/option-sets/${linkId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to update option set link');
  }
}

export async function detachOptionSetFromProduct(productId: number, linkId: number): Promise<void> {
  const res = await fetch(`/api/products/${productId}/option-sets/${linkId}`, { method: 'DELETE' });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to detach option set');
  }
}

export async function updateGroupOverlay(
  productId: number,
  linkId: number,
  optionSetGroupId: number,
  payload: { alias_label?: string | null; is_required?: boolean; hide?: boolean; display_order?: number }
): Promise<void> {
  const res = await fetch(`/api/products/${productId}/option-sets/${linkId}/groups/${optionSetGroupId}/overlay`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to update group overlay');
  }
}

export async function clearGroupOverlay(productId: number, linkId: number, optionSetGroupId: number): Promise<void> {
  const res = await fetch(`/api/products/${productId}/option-sets/${linkId}/groups/${optionSetGroupId}/overlay`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to clear group overlay');
  }
}

export async function updateValueOverlay(
  productId: number,
  linkId: number,
  optionSetValueId: number,
  payload: { alias_label?: string | null; is_default?: boolean; hide?: boolean; display_order?: number }
): Promise<void> {
  const res = await fetch(`/api/products/${productId}/option-sets/${linkId}/values/${optionSetValueId}/overlay`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to update value overlay');
  }
}

export async function clearValueOverlay(productId: number, linkId: number, optionSetValueId: number): Promise<void> {
  const res = await fetch(`/api/products/${productId}/option-sets/${linkId}/values/${optionSetValueId}/overlay`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || 'Failed to clear value overlay');
  }
}
