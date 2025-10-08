import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    setId?: string;
    groupId?: string;
    valueId?: string;
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

async function ensureValueBelongs(client: any, setId: number, groupId: number, valueId: number) {
  const { data, error } = await client
    .from('option_set_values')
    .select('option_set_groups(option_set_id, option_set_group_id)')
    .eq('option_set_value_id', valueId)
    .single();

  const group = data ? (data as any).option_set_groups : null;
  if (error || !group || Number(group.option_set_group_id) !== groupId || Number(group.option_set_id) !== setId) {
    throw new Error('Not found');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  const groupId = parseId(params.groupId);
  const valueId = parseId(params.valueId);
  if (!setId || !groupId || !valueId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.code === 'string') {
    const code = body.code.trim();
    if (!code) return NextResponse.json({ error: 'Value code cannot be empty' }, { status: 400 });
    updates.code = code;
  }
  if (typeof body.label === 'string') {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ error: 'Value label cannot be empty' }, { status: 400 });
    updates.label = label;
  }
  if (typeof body.is_default === 'boolean') {
    updates.is_default = body.is_default;
  }
  if (typeof body.display_order === 'number' && Number.isFinite(body.display_order)) {
    updates.display_order = body.display_order;
  }
  if (body.attributes && typeof body.attributes === 'object') {
    updates.attributes = body.attributes;
  } else if (body.attributes === null) {
    updates.attributes = null;
  }
  if (body.default_component_id === null || Number.isInteger(body.default_component_id)) {
    updates.default_component_id = body.default_component_id;
  }
  if (
    body.default_supplier_component_id === null ||
    Number.isInteger(body.default_supplier_component_id)
  ) {
    updates.default_supplier_component_id = body.default_supplier_component_id;
  }
  if (typeof body.default_quantity_delta === 'number') {
    updates.default_quantity_delta = body.default_quantity_delta;
  } else if (body.default_quantity_delta === null) {
    updates.default_quantity_delta = null;
  }
  if (typeof body.default_notes === 'string') {
    updates.default_notes = body.default_notes;
  } else if (body.default_notes === null) {
    updates.default_notes = null;
  }
  if (typeof body.default_is_cutlist === 'boolean') {
    updates.default_is_cutlist = body.default_is_cutlist;
  } else if (body.default_is_cutlist === null) {
    updates.default_is_cutlist = null;
  }
  if (typeof body.default_cutlist_category === 'string') {
    updates.default_cutlist_category = body.default_cutlist_category;
  } else if (body.default_cutlist_category === null) {
    updates.default_cutlist_category = null;
  }
  if (body.default_cutlist_dimensions && typeof body.default_cutlist_dimensions === 'object') {
    updates.default_cutlist_dimensions = body.default_cutlist_dimensions;
  } else if (body.default_cutlist_dimensions === null) {
    updates.default_cutlist_dimensions = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureValueBelongs(supabase, setId, groupId, valueId);

    if (updates.is_default === true) {
      const { error: resetError } = await supabase
        .from('option_set_values')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('option_set_group_id', groupId)
        .neq('option_set_value_id', valueId);
      if (resetError) {
        console.error('[option-set-values] failed clearing previous defaults (update)', resetError);
        return NextResponse.json({ error: 'Failed to reset previous defaults before updating value' }, { status: 400 });
      }
    }

    const { error } = await supabase
      .from('option_set_values')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('option_set_value_id', valueId);

    if (error) {
      console.error('[option-set-values] failed updating value', error);
      const message = error.code === '23505'
        ? 'Another value already uses that code'
        : 'Failed to update option value';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option value not found for set/group' }, { status: 404 });
    }
    console.error('[option-set-values] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option value' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  const groupId = parseId(params.groupId);
  const valueId = parseId(params.valueId);
  if (!setId || !groupId || !valueId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureValueBelongs(supabase, setId, groupId, valueId);

    const { error } = await supabase
      .from('option_set_values')
      .delete()
      .eq('option_set_value_id', valueId);

    if (error) {
      console.error('[option-set-values] failed deleting value', error);
      return NextResponse.json({ error: 'Failed to delete option value' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option value not found for set/group' }, { status: 404 });
    }
    console.error('[option-set-values] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting option value' }, { status: 500 });
  }
}
