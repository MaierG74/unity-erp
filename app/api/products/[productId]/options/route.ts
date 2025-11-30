import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  productId?: string;
};

function parseProductId(productId?: string): number | null {
  if (!productId) return null;
  const parsed = Number.parseInt(productId, 10);
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

export async function GET(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseProductId(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const [{ data: groupsRaw, error: groupsError }, { data: linksRaw, error: linksError }] = await Promise.all([
      supabase
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
        .order('display_order', { ascending: true }),
      supabase
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
                attributes,
                default_component_id,
                default_supplier_component_id,
                default_quantity_delta,
                default_notes,
                default_is_cutlist,
                default_cutlist_category,
                default_cutlist_dimensions
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
        .order('display_order', { ascending: true }),
    ]);

    if (groupsError) {
      console.error('[options] failed loading product groups', groupsError);
      return NextResponse.json({ error: 'Failed to load option groups' }, { status: 500 });
    }

    if (linksError) {
      console.error('[options] failed loading option set links', linksError);
      return NextResponse.json({ error: 'Failed to load option set links' }, { status: 500 });
    }

    const productGroups = (groupsRaw ?? []).map(group => ({
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

    const optionSetLinks = (linksRaw ?? []).map((link: any) => {
      const optionSetRecord = Array.isArray(link.option_sets) ? link.option_sets[0] : link.option_sets;
      const rawGroups = optionSetRecord?.option_set_groups ?? [];

      const normalizedGroups = rawGroups
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
              default_component_id: value.default_component_id != null ? Number(value.default_component_id) : null,
              default_supplier_component_id: value.default_supplier_component_id != null ? Number(value.default_supplier_component_id) : null,
              default_quantity_delta: value.default_quantity_delta != null ? Number(value.default_quantity_delta) : null,
              default_notes: value.default_notes ?? null,
              default_is_cutlist: value.default_is_cutlist === null || value.default_is_cutlist === undefined ? null : Boolean(value.default_is_cutlist),
              default_cutlist_category: value.default_cutlist_category ?? null,
              default_cutlist_dimensions: value.default_cutlist_dimensions ?? null,
            }))
            .sort((a: any, b: any) => a.display_order - b.display_order),
        }))
        .sort((a: any, b: any) => a.display_order - b.display_order);

      return {
        link_id: Number(link.link_id),
        product_id: Number(link.product_id),
        option_set_id: Number(link.option_set_id),
        display_order: Number(link.display_order ?? 0),
        alias_label: link.alias_label ?? null,
        option_set: optionSetRecord
          ? {
              option_set_id: Number(optionSetRecord.option_set_id),
              code: optionSetRecord.code,
              name: optionSetRecord.name,
              description: optionSetRecord.description ?? null,
              groups: normalizedGroups,
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
      };
    });

    return NextResponse.json({ product_groups: productGroups, option_set_links: optionSetLinks });
  } catch (error) {
    console.error('[options] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading options' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseProductId(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const isRequired = body.is_required === false ? false : true;
  const displayOrderInput = body.display_order;

  if (!code) {
    return NextResponse.json({ error: 'Option group code is required' }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: 'Option group label is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    let resolvedDisplayOrder: number | null = null;
    if (typeof displayOrderInput === 'number' && Number.isFinite(displayOrderInput)) {
      resolvedDisplayOrder = displayOrderInput;
    } else {
      const { data: maxRows, error: maxError } = await supabase
        .from('product_option_groups')
        .select('display_order')
        .eq('product_id', productId)
        .order('display_order', { ascending: false })
        .limit(1);
      if (maxError) {
        console.warn('[options] failed fetching existing order', maxError);
      }
      const currentMax = maxRows && maxRows.length > 0 ? Number(maxRows[0].display_order ?? 0) : -1;
      resolvedDisplayOrder = currentMax + 1;
    }

    const { data, error } = await supabase
      .from('product_option_groups')
      .insert({
        product_id: productId,
        code,
        label,
        is_required: isRequired,
        display_order: resolvedDisplayOrder ?? 0,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[options] failed creating group', error);
      const message = error.code === '23505'
        ? 'An option group with this code already exists for the product'
        : 'Failed to create option group';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const created = {
      option_group_id: Number(data.option_group_id),
      product_id: Number(data.product_id),
      code: data.code,
      label: data.label,
      display_order: Number(data.display_order ?? 0),
      is_required: Boolean(data.is_required),
      values: [] as any[],
    };

    return NextResponse.json({ group: created }, { status: 201 });
  } catch (error) {
    console.error('[options] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating option group' }, { status: 500 });
  }
}
