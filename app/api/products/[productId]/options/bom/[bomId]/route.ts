import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    productId?: string;
    bomId?: string;
  };
}

function parseId(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && !Number.isNaN(parsed) ? parsed : null;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables are not configured');
  }
  return createClient(url, key);
}

async function ensureBomBelongsToProduct(client: ReturnType<typeof createClient>, productId: number, bomId: number) {
  const { data, error } = await client
    .from('billofmaterials')
    .select('product_id')
    .eq('bom_id', bomId)
    .single();

  if (error || !data || Number(data.product_id) !== productId) {
    throw new Error('Not found');
  }
}

async function loadProductOptionGroups(client: ReturnType<typeof createClient>, productId: number) {
  const { data, error } = await client
    .from('product_option_groups')
    .select(`
      option_group_id,
      product_id,
      code,
      label,
      display_order,
      is_required,
      product_option_values (
        option_value_id,
        option_group_id,
        code,
        label,
        is_default,
        display_order,
        attributes
      )
    `)
    .eq('product_id', productId)
    .order('display_order', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((group: any) => ({
    option_group_id: Number(group.option_group_id),
    product_id: Number(group.product_id),
    code: group.code,
    label: group.label,
    display_order: Number(group.display_order ?? 0),
    is_required: Boolean(group.is_required),
    values: (group.product_option_values ?? [])
      .map((value: any) => ({
        option_value_id: Number(value.option_value_id),
        option_group_id: Number(value.option_group_id),
        code: value.code,
        label: value.label,
        is_default: Boolean(value.is_default),
        display_order: Number(value.display_order ?? 0),
        attributes: value.attributes ?? null,
      }))
      .sort((a: any, b: any) => a.display_order - b.display_order),
  }));
}

async function loadProductOptionSets(client: ReturnType<typeof createClient>, productId: number) {
  const { data, error } = await client
    .from('product_option_set_links')
    .select(`
      link_id,
      product_id,
      option_set_id,
      display_order,
      alias_label,
      option_sets:option_sets (
        option_set_id,
        code,
        name,
        description,
        option_set_groups (
          option_set_group_id,
          code,
          label,
          display_order,
          is_required,
          option_set_values (
            option_set_value_id,
            code,
            label,
            is_default,
            display_order,
            attributes
          )
        )
      ),
      product_option_group_overlays (
        overlay_id,
        option_set_group_id,
        alias_label,
        is_required,
        hide,
        display_order
      ),
      product_option_value_overlays (
        overlay_id,
        option_set_value_id,
        alias_label,
        is_default,
        hide,
        display_order
      )
    `)
    .eq('product_id', productId)
    .order('display_order', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((link: any) => ({
    link_id: Number(link.link_id),
    product_id: Number(link.product_id),
    option_set_id: Number(link.option_set_id),
    display_order: Number(link.display_order ?? 0),
    alias_label: link.alias_label ?? null,
    option_set: link.option_sets
      ? {
          option_set_id: Number(link.option_sets.option_set_id),
          code: link.option_sets.code,
          name: link.option_sets.name,
          description: link.option_sets.description ?? null,
          groups: (link.option_sets.option_set_groups ?? [])
            .map((group: any) => ({
              option_set_group_id: Number(group.option_set_group_id),
              code: group.code,
              label: group.label,
              display_order: Number(group.display_order ?? 0),
              is_required: Boolean(group.is_required),
              values: (group.option_set_values ?? [])
                .map((value: any) => ({
                  option_set_value_id: Number(value.option_set_value_id),
                  code: value.code,
                  label: value.label,
                  is_default: Boolean(value.is_default),
                  display_order: Number(value.display_order ?? 0),
                  attributes: value.attributes ?? null,
                }))
                .sort((a: any, b: any) => a.display_order - b.display_order),
            }))
            .sort((a: any, b: any) => a.display_order - b.display_order),
        }
      : null,
    group_overlays: (link.product_option_group_overlays ?? []).map((overlay: any) => ({
      overlay_id: Number(overlay.overlay_id),
      option_set_group_id: Number(overlay.option_set_group_id),
      alias_label: overlay.alias_label ?? null,
      is_required: overlay.is_required === null || overlay.is_required === undefined ? null : Boolean(overlay.is_required),
      hide: Boolean(overlay.hide),
      display_order: overlay.display_order === null || overlay.display_order === undefined ? null : Number(overlay.display_order),
    })),
    value_overlays: (link.product_option_value_overlays ?? []).map((overlay: any) => ({
      overlay_id: Number(overlay.overlay_id),
      option_set_value_id: Number(overlay.option_set_value_id),
      alias_label: overlay.alias_label ?? null,
      is_default: overlay.is_default === null || overlay.is_default === undefined ? null : Boolean(overlay.is_default),
      hide: Boolean(overlay.hide),
      display_order: overlay.display_order === null || overlay.display_order === undefined ? null : Number(overlay.display_order),
    })),
  }));
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const bomId = parseId(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureBomBelongsToProduct(supabase, productId, bomId);

    const [productGroups, productSets] = await Promise.all([
      loadProductOptionGroups(supabase, productId).catch((error) => {
        console.error('[bom-overrides] failed loading product groups', error);
        throw new Error('GROUPS_FAILED');
      }),
      loadProductOptionSets(supabase, productId).catch((error) => {
        console.error('[bom-overrides] failed loading option sets', error);
        throw new Error('SETS_FAILED');
      }),
    ]);

    const { data: overridesData, error: overridesError } = await supabase
      .from('bom_option_overrides')
      .select('*')
      .eq('bom_id', bomId);

    if (overridesError) {
      console.error('[bom-overrides] failed loading overrides', overridesError);
      return NextResponse.json({ error: 'Failed to load overrides' }, { status: 500 });
    }

    return NextResponse.json({
      product_groups: productGroups,
      option_sets: productSets,
      overrides: overridesData ?? [],
    });
  } catch (error: any) {
    if (error?.message === 'GROUPS_FAILED') {
      return NextResponse.json({ error: 'Failed to load product option groups' }, { status: 500 });
    }
    if (error?.message === 'SETS_FAILED') {
      return NextResponse.json({ error: 'Failed to load option sets' }, { status: 500 });
    }
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }
    console.error('[bom-overrides] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading overrides' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const bomId = parseId(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const optionValueId = parseId(String(payload.option_value_id ?? ''));
  const optionSetValueId = parseId(String(payload.option_set_value_id ?? ''));

  if (!optionValueId && !optionSetValueId) {
    return NextResponse.json({ error: 'option_value_id or option_set_value_id is required' }, { status: 400 });
  }
  if (optionValueId && optionSetValueId) {
    return NextResponse.json({ error: 'Provide only one of option_value_id or option_set_value_id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureBomBelongsToProduct(supabase, productId, bomId);
    let conflictTarget = 'bom_id,option_value_id';

    if (optionValueId) {
      const { data: ownership, error: ownershipError } = await supabase
        .from('product_option_values')
        .select('option_group_id, product_option_groups(product_id)')
        .eq('option_value_id', optionValueId)
        .maybeSingle();

      if (ownershipError || !ownership || Number(ownership.product_option_groups?.product_id) !== productId) {
        return NextResponse.json({ error: 'Option value does not belong to this product' }, { status: 400 });
      }
    }

    if (optionSetValueId) {
      conflictTarget = 'bom_id,option_set_value_id';
      const { data: valueRow, error: valueError } = await supabase
        .from('option_set_values')
        .select('option_set_groups(option_set_id)')
        .eq('option_set_value_id', optionSetValueId)
        .maybeSingle();

      if (valueError || !valueRow) {
        return NextResponse.json({ error: 'Option set value not found' }, { status: 400 });
      }

      const optionSetId = Number(valueRow.option_set_groups?.option_set_id);
      const { data: linkRow, error: linkError } = await supabase
        .from('product_option_set_links')
        .select('link_id')
        .eq('product_id', productId)
        .eq('option_set_id', optionSetId)
        .maybeSingle();

      if (linkError || !linkRow) {
        return NextResponse.json({ error: 'Option set value is not attached to this product' }, { status: 400 });
      }
    }

    const cutlistDimensions = payload.cutlist_dimensions;
    const attributes = payload.attributes;

    const upsertData: Record<string, any> = {
      bom_id: bomId,
      option_value_id: optionValueId ?? null,
      option_set_value_id: optionSetValueId ?? null,
      replace_component_id: payload.replace_component_id ?? null,
      replace_supplier_component_id: payload.replace_supplier_component_id ?? null,
      quantity_delta: payload.quantity_delta ?? null,
      notes: typeof payload.notes === 'string' ? payload.notes : null,
      is_cutlist_item: typeof payload.is_cutlist_item === 'boolean' ? payload.is_cutlist_item : null,
      cutlist_category: typeof payload.cutlist_category === 'string' ? payload.cutlist_category : null,
      cutlist_dimensions: cutlistDimensions && typeof cutlistDimensions === 'object' ? cutlistDimensions : null,
      attributes: attributes && typeof attributes === 'object' ? attributes : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('bom_option_overrides')
      .upsert(upsertData, { onConflict: conflictTarget })
      .select('*')
      .single();

    if (error) {
      console.error('[bom-overrides] failed upserting override', error);
      return NextResponse.json({ error: 'Failed to save override' }, { status: 400 });
    }

    return NextResponse.json({ override: data });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }
    console.error('[bom-overrides] unexpected upsert error', error);
    return NextResponse.json({ error: 'Unexpected error while saving override' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const bomId = parseId(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const optionValueId = parseId(String(payload.option_value_id ?? ''));
  const optionSetValueId = parseId(String(payload.option_set_value_id ?? ''));

  if (!optionValueId && !optionSetValueId) {
    return NextResponse.json({ error: 'option_value_id or option_set_value_id is required' }, { status: 400 });
  }
  if (optionValueId && optionSetValueId) {
    return NextResponse.json({ error: 'Provide only one of option_value_id or option_set_value_id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureBomBelongsToProduct(supabase, productId, bomId);

    const query = supabase
      .from('bom_option_overrides')
      .delete()
      .eq('bom_id', bomId);

    if (optionValueId) {
      query.eq('option_value_id', optionValueId);
    } else if (optionSetValueId) {
      query.eq('option_set_value_id', optionSetValueId);
    }

    const { error } = await query;

    if (error) {
      console.error('[bom-overrides] failed deleting override', error);
      return NextResponse.json({ error: 'Failed to delete override' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }
    console.error('[bom-overrides] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting override' }, { status: 500 });
  }
}
