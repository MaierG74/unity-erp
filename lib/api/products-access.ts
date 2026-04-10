import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

export type ProductsAccess = {
  orgId: string;
};

type ComponentRef = {
  componentId?: number | null;
  supplierComponentId?: number | null;
};

export function parsePositiveInt(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function requireProductsAccess(
  request: NextRequest
): Promise<{ error: NextResponse } | ProductsAccess> {
  const access = await requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM, {
    forbiddenMessage: 'Products module access is disabled for your organization',
  });

  if ('error' in access) {
    return { error: access.error };
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for products access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }

  return { orgId: access.orgId };
}

export async function productExistsInOrg(productId: number, orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('product_id')
    .eq('product_id', productId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function productOptionGroupBelongsToProduct(
  productId: number,
  groupId: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('product_option_groups')
    .select('option_group_id')
    .eq('option_group_id', groupId)
    .eq('product_id', productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function productOptionValueBelongsToProduct(
  productId: number,
  groupId: number,
  valueId: number
): Promise<boolean> {
  const groupBelongs = await productOptionGroupBelongsToProduct(productId, groupId);
  if (!groupBelongs) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from('product_option_values')
    .select('option_value_id')
    .eq('option_value_id', valueId)
    .eq('option_group_id', groupId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function optionSetLinkForProduct(
  productId: number,
  linkId: number
): Promise<{ optionSetId: number } | null> {
  const { data, error } = await supabaseAdmin
    .from('product_option_set_links')
    .select('option_set_id')
    .eq('link_id', linkId)
    .eq('product_id', productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as { option_set_id?: number | null } | null;
  if (!row) {
    return null;
  }

  return {
    optionSetId: Number(row.option_set_id),
  };
}

export async function optionSetAttachedToProduct(
  productId: number,
  optionSetId: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('product_option_set_links')
    .select('link_id')
    .eq('product_id', productId)
    .eq('option_set_id', optionSetId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function optionSetGroupBelongsToSet(
  optionSetId: number,
  groupId: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('option_set_groups')
    .select('option_set_group_id')
    .eq('option_set_group_id', groupId)
    .eq('option_set_id', optionSetId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function optionSetValueBelongsToSet(
  optionSetId: number,
  valueId: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('option_set_values')
    .select('option_set_group_id')
    .eq('option_set_value_id', valueId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const optionSetGroupId = parsePositiveInt(
    String((data as { option_set_group_id?: number | null } | null)?.option_set_group_id ?? '')
  );
  if (!optionSetGroupId) {
    return false;
  }

  return optionSetGroupBelongsToSet(optionSetId, optionSetGroupId);
}

export async function optionSetValueAttachedToProduct(
  productId: number,
  optionSetValueId: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('option_set_values')
    .select('option_set_groups(option_set_id)')
    .eq('option_set_value_id', optionSetValueId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as
    | {
        option_set_groups?:
          | { option_set_id?: number | null }
          | Array<{ option_set_id?: number | null }>
          | null;
      }
    | null;
  const group = Array.isArray(row?.option_set_groups)
    ? row?.option_set_groups[0]
    : row?.option_set_groups;
  const optionSetId = parsePositiveInt(group?.option_set_id ?? null);
  if (!optionSetId) {
    return false;
  }

  return optionSetAttachedToProduct(productId, optionSetId);
}

export async function bomBelongsToProduct(productId: number, bomId: number): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('billofmaterials')
    .select('bom_id')
    .eq('bom_id', bomId)
    .eq('product_id', productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function validateOrgScopedComponentRefs(
  orgId: string,
  refs: ComponentRef[]
): Promise<string | null> {
  const componentIds = Array.from(
    new Set(
      refs
        .map((ref) => ref.componentId)
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
    )
  );
  const supplierComponentIds = Array.from(
    new Set(
      refs
        .map((ref) => ref.supplierComponentId)
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
    )
  );

  if (componentIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('components')
      .select('component_id')
      .eq('org_id', orgId)
      .in('component_id', componentIds);

    if (error) {
      throw new Error(error.message);
    }

    const found = new Set((data ?? []).map((row) => Number((row as { component_id: number }).component_id)));
    if (componentIds.some((id) => !found.has(id))) {
      return 'One or more components do not belong to this organization';
    }
  }

  if (supplierComponentIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('suppliercomponents')
      .select('supplier_component_id')
      .eq('org_id', orgId)
      .in('supplier_component_id', supplierComponentIds);

    if (error) {
      throw new Error(error.message);
    }

    const found = new Set(
      (data ?? []).map((row) => Number((row as { supplier_component_id: number }).supplier_component_id))
    );
    if (supplierComponentIds.some((id) => !found.has(id))) {
      return 'One or more supplier components do not belong to this organization';
    }
  }

  return null;
}
