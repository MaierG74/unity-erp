import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    setId?: string;
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

async function fetchOptionSet(setId: number) {
  const supabase = getSupabaseAdmin();
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
          attributes
        )
      ),
      product_option_set_links(count)
    `)
    .eq('option_set_id', setId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    option_set_id: Number(data.option_set_id),
    code: data.code,
    name: data.name,
    description: data.description ?? null,
    created_at: data.created_at,
    updated_at: data.updated_at,
    usage_count: Array.isArray(data.product_option_set_links) ? Number(data.product_option_set_links[0]?.count ?? 0) : 0,
    groups: (data.option_set_groups ?? [])
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
  };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  if (!setId) {
    return NextResponse.json({ error: 'Invalid option set id' }, { status: 400 });
  }

  try {
    const set = await fetchOptionSet(setId);
    if (!set) {
      return NextResponse.json({ error: 'Option set not found' }, { status: 404 });
    }

    return NextResponse.json({ option_set: set });
  } catch (error) {
    console.error('[option-sets] failed loading set', error);
    return NextResponse.json({ error: 'Failed to load option set' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  if (!setId) {
    return NextResponse.json({ error: 'Invalid option set id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.code === 'string') {
    const code = body.code.trim();
    if (!code) return NextResponse.json({ error: 'Option set code cannot be empty' }, { status: 400 });
    updates.code = code;
  }
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'Option set name cannot be empty' }, { status: 400 });
    updates.name = name;
  }
  if (typeof body.description === 'string') {
    updates.description = body.description.trim();
  } else if (body.description === null) {
    updates.description = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { error } = await supabase
      .from('option_sets')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('option_set_id', setId);

    if (error) {
      console.error('[option-sets] failed updating set', error);
      const message = error.code === '23505'
        ? 'Another option set already uses that code'
        : 'Failed to update option set';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const refreshed = await fetchOptionSet(setId);
    if (!refreshed) {
      return NextResponse.json({ error: 'Option set not found after update' }, { status: 404 });
    }

    return NextResponse.json({ option_set: refreshed });
  } catch (error) {
    console.error('[option-sets] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option set' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  if (!setId) {
    return NextResponse.json({ error: 'Invalid option set id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data: usageRows, error: usageError } = await supabase
      .from('product_option_set_links')
      .select('link_id')
      .eq('option_set_id', setId)
      .limit(1);

    if (usageError) {
      console.error('[option-sets] usage check failed', usageError);
      return NextResponse.json({ error: 'Failed to verify option set usage' }, { status: 500 });
    }

    if (usageRows && usageRows.length > 0) {
      return NextResponse.json({ error: 'Option set is attached to products and cannot be deleted' }, { status: 409 });
    }

    const { error } = await supabase
      .from('option_sets')
      .delete()
      .eq('option_set_id', setId);

    if (error) {
      console.error('[option-sets] failed deleting set', error);
      return NextResponse.json({ error: 'Failed to delete option set' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[option-sets] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting option set' }, { status: 500 });
  }
}
