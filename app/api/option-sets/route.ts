import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase environment variables are not configured');
  }
  return createClient(url, key);
}

export async function GET() {
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('option_sets')
      .select(`
        option_set_id,
        code,
        name,
        description,
        created_at,
        updated_at,
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
        ),
        product_option_set_links(count)
      `)
      .order('name', { ascending: true });

    if (error) {
      console.error('[option-sets] failed loading sets', error);
      return NextResponse.json({ error: 'Failed to load option sets' }, { status: 500 });
    }

    const sets = (data ?? []).map(set => ({
      option_set_id: Number(set.option_set_id),
      code: set.code,
      name: set.name,
      description: set.description ?? null,
      created_at: set.created_at,
      updated_at: set.updated_at,
      usage_count: Array.isArray(set.product_option_set_links) ? Number(set.product_option_set_links[0]?.count ?? 0) : 0,
      groups: (set.option_set_groups ?? [])
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
        .sort((a: any, b: any) => a.display_order - b.display_order),
    }));

    return NextResponse.json({ sets });
  } catch (error) {
    console.error('[option-sets] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading option sets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : null;

  if (!code) {
    return NextResponse.json({ error: 'Option set code is required' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Option set name is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('option_sets')
      .insert({ code, name, description })
      .select('*')
      .single();

    if (error) {
      console.error('[option-sets] failed creating set', error);
      const message = error.code === '23505'
        ? 'An option set with this code already exists'
        : 'Failed to create option set';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({
      option_set: {
        option_set_id: Number(data.option_set_id),
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        created_at: data.created_at,
        updated_at: data.updated_at,
        usage_count: 0,
        groups: [] as any[],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[option-sets] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating option set' }, { status: 500 });
  }
}
