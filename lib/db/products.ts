import { supabase } from '@/lib/supabase';

export interface ProductOptionSelection {
  [groupCode: string]: string;
}

export interface ResolvedProductComponent {
  component_id: number;
  quantity: number;
  supplier_component_id: number | null;
  configuration_scope: string;
  option_group_code: string | null;
  option_value_code: string | null;
  quantity_source: string | null;
  notes: string | null;
  is_cutlist_item: boolean;
  cutlist_category: string | null;
  cutlist_dimensions: Record<string, unknown> | null;
  attributes: Record<string, unknown> | null;
  component_description: string | null;
  supplier_price: number | null;
}

export interface ProductOptionValue {
  option_value_id: number;
  code: string;
  label: string;
  is_default: boolean;
  attributes: Record<string, unknown> | null;
  display_order: number;
}

export interface ProductOptionGroup {
  option_group_id: number;
  code: string;
  label: string;
  is_required: boolean;
  display_order: number;
  values: ProductOptionValue[];
}

function mapResolvedRow(row: any): ResolvedProductComponent {
  return {
    component_id: Number(row.component_id),
    quantity: Number(row.quantity ?? 0),
    supplier_component_id: row.supplier_component_id != null ? Number(row.supplier_component_id) : null,
    configuration_scope: row.configuration_scope ?? 'base',
    option_group_code: row.option_group_code ?? null,
    option_value_code: row.option_value_code ?? null,
    quantity_source: row.quantity_source ?? null,
    notes: row.notes ?? null,
    is_cutlist_item: Boolean(row.is_cutlist_item),
    cutlist_category: row.cutlist_category ?? null,
    cutlist_dimensions: row.cutlist_dimensions ?? null,
    attributes: row.attributes ?? null,
    component_description: row.component_description ?? null,
    supplier_price: row.supplier_price != null ? Number(row.supplier_price) : null,
  };
}

export async function resolveProductConfiguration(
  productId: number,
  selectedOptions: ProductOptionSelection = {}
): Promise<ResolvedProductComponent[]> {
  try {
    const { data, error } = await supabase.rpc('get_product_components', {
      product_id: productId as any,
      selected_options: selectedOptions,
    });

    if (!error && Array.isArray(data)) {
      return data.map(mapResolvedRow);
    }

    if (error) {
      console.warn('get_product_components RPC fallback:', error.message);
    }
  } catch (rpcError) {
    console.warn('get_product_components RPC error:', rpcError);
  }

  try {
    const { data, error } = await supabase
      .from('billofmaterials')
      .select(
        `component_id,
         quantity_required,
         supplier_component_id,
         is_cutlist_item,
         cutlist_category,
         cutlist_dimensions,
         attributes,
         components(description),
         suppliercomponents(price)`
      )
      .eq('product_id', productId);

    if (!error && Array.isArray(data)) {
      return data.map((row: any) => {
        const supplierRelation = row?.suppliercomponents;
        const supplierRecord = Array.isArray(supplierRelation)
          ? supplierRelation[0]
          : supplierRelation;

        return {
          component_id: Number(row.component_id),
          quantity: Number(row.quantity_required ?? 0),
          supplier_component_id: row.supplier_component_id != null ? Number(row.supplier_component_id) : null,
          configuration_scope: 'base',
          option_group_code: null,
          option_value_code: null,
          quantity_source: 'billofmaterials',
          notes: null,
          is_cutlist_item: Boolean(row.is_cutlist_item),
          cutlist_category: row.cutlist_category ?? null,
          cutlist_dimensions: row.cutlist_dimensions ?? null,
          attributes: row.attributes ?? null,
          component_description: row?.components?.description ?? null,
          supplier_price:
            supplierRecord?.price != null ? Number(supplierRecord.price) : null,
        };
      });
    }

    if (error) {
      console.warn('billofmaterials fallback failed:', error.message);
    }
  } catch (fallbackError) {
    console.warn('billofmaterials fallback error:', fallbackError);
  }

  return [];
}

export async function fetchProductOptionGroups(productId: number): Promise<ProductOptionGroup[]> {
  try {
    const { data, error } = await supabase
      .from('product_option_groups')
      .select(
        `option_group_id, code, label, is_required, display_order,
         product_option_values:product_option_values(option_value_id, code, label, is_default, display_order, attributes)`
      )
      .eq('product_id', productId)
      .order('display_order', { ascending: true });

    if (error) {
      console.warn('fetchProductOptionGroups unavailable:', error.message);
      return [];
    }

    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((group: any) => {
      const valuesRaw = Array.isArray(group?.product_option_values) ? group.product_option_values : [];
      const values = valuesRaw
        .map((value: any) => ({
          option_value_id: Number(value.option_value_id),
          code: value.code ?? String(value.option_value_id),
          label: value.label ?? value.code ?? String(value.option_value_id),
          is_default: Boolean(value.is_default),
          attributes: value.attributes ?? null,
          display_order: Number(value.display_order ?? 0),
        }))
        .sort((a: ProductOptionValue, b: ProductOptionValue) => a.display_order - b.display_order);

      return {
        option_group_id: Number(group.option_group_id),
        code: group.code ?? String(group.option_group_id),
        label: group.label ?? group.code ?? String(group.option_group_id),
        is_required: Boolean(group.is_required),
        display_order: Number(group.display_order ?? 0),
        values,
      } as ProductOptionGroup;
    });
  } catch (error) {
    console.warn('fetchProductOptionGroups error:', error);
    return [];
  }
}
