import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    setId?: string;
    groupId?: string;
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

async function ensureGroupBelongsToSet(client: ReturnType<typeof createClient>, setId: number, groupId: number) {
  const { data, error } = await client
    .from('option_set_groups')
    .select('option_set_id')
    .eq('option_set_group_id', groupId)
    .single();

  if (error || !data || Number(data.option_set_id) !== setId) {
    throw new Error('Not found');
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  const groupId = parseId(params.groupId);
  if (!setId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const isDefault = body.is_default === true;
  const displayOrderInput = body.display_order;
  const attributes = body.attributes && typeof body.attributes === 'object' ? body.attributes : null;
  const defaultComponentId =
    body.default_component_id === null || Number.isInteger(body.default_component_id)
      ? body.default_component_id
      : undefined;
  const defaultSupplierComponentId =
    body.default_supplier_component_id === null || Number.isInteger(body.default_supplier_component_id)
      ? body.default_supplier_component_id
      : undefined;
  const defaultQuantityDelta =
    typeof body.default_quantity_delta === 'number'
      ? body.default_quantity_delta
      : body.default_quantity_delta === null
        ? null
        : undefined;
  const defaultNotes = typeof body.default_notes === 'string'
    ? body.default_notes.trim()
    : body.default_notes === null
      ? null
      : undefined;
  const defaultIsCutlist = typeof body.default_is_cutlist === 'boolean'
    ? body.default_is_cutlist
    : body.default_is_cutlist === null
      ? null
      : undefined;
  const defaultCutlistCategory = typeof body.default_cutlist_category === 'string'
    ? body.default_cutlist_category.trim()
    : body.default_cutlist_category === null
      ? null
      : undefined;
  const defaultCutlistDimensions =
    body.default_cutlist_dimensions && typeof body.default_cutlist_dimensions === 'object'
      ? body.default_cutlist_dimensions
      : body.default_cutlist_dimensions === null
        ? null
        : undefined;

  if (!code) {
    return NextResponse.json({ error: 'Option value code is required' }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ error: 'Option value label is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureGroupBelongsToSet(supabase, setId, groupId);

    let resolvedDisplayOrder: number | null = null;
    if (typeof displayOrderInput === 'number' && Number.isFinite(displayOrderInput)) {
      resolvedDisplayOrder = displayOrderInput;
    } else {
      const { data: maxRows, error: maxError } = await supabase
        .from('option_set_values')
        .select('display_order')
        .eq('option_set_group_id', groupId)
        .order('display_order', { ascending: false })
        .limit(1);
      if (maxError) {
        console.warn('[option-set-values] failed fetching existing order', maxError);
      }
      const currentMax = maxRows && maxRows.length > 0 ? Number(maxRows[0].display_order ?? 0) : -1;
      resolvedDisplayOrder = currentMax + 1;
    }

    if (isDefault) {
      const { error: resetError } = await supabase
        .from('option_set_values')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('option_set_group_id', groupId);
      if (resetError) {
        console.error('[option-set-values] failed clearing previous defaults', resetError);
        return NextResponse.json({ error: 'Failed to reset previous defaults before creating value' }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from('option_set_values')
      .insert({
        option_set_group_id: groupId,
        code,
        label,
        is_default: isDefault,
        display_order: resolvedDisplayOrder ?? 0,
        attributes,
        default_component_id: defaultComponentId,
        default_supplier_component_id: defaultSupplierComponentId,
        default_quantity_delta: defaultQuantityDelta,
        default_notes: defaultNotes,
        default_is_cutlist: defaultIsCutlist,
        default_cutlist_category: defaultCutlistCategory,
        default_cutlist_dimensions: defaultCutlistDimensions,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[option-set-values] failed creating value', error);
      const message = error.code === '23505'
        ? 'An option value with this code already exists for the group'
        : 'Failed to create option value';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({
      option_set_value: {
        option_set_value_id: Number(data.option_set_value_id),
        option_set_group_id: Number(data.option_set_group_id),
        code: data.code,
        label: data.label,
        is_default: Boolean(data.is_default),
        display_order: Number(data.display_order ?? 0),
        attributes: data.attributes ?? null,
        default_component_id: data.default_component_id ?? null,
        default_supplier_component_id: data.default_supplier_component_id ?? null,
        default_quantity_delta: data.default_quantity_delta ?? null,
        default_notes: data.default_notes ?? null,
        default_is_cutlist: data.default_is_cutlist ?? null,
        default_cutlist_category: data.default_cutlist_category ?? null,
        default_cutlist_dimensions: data.default_cutlist_dimensions ?? null,
      },
    }, { status: 201 });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option group not found for set' }, { status: 404 });
    }
    console.error('[option-set-values] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating option value' }, { status: 500 });
  }
}
