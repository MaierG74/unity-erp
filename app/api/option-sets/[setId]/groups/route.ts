import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  setId?: string;
};

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

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const setId = parseId(params.setId);
  if (!setId) {
    return NextResponse.json({ error: 'Invalid option set id' }, { status: 400 });
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
        .from('option_set_groups')
        .select('display_order')
        .eq('option_set_id', setId)
        .order('display_order', { ascending: false })
        .limit(1);
      if (maxError) {
        console.warn('[option-set-groups] failed fetching existing order', maxError);
      }
      const currentMax = maxRows && maxRows.length > 0 ? Number(maxRows[0].display_order ?? 0) : -1;
      resolvedDisplayOrder = currentMax + 1;
    }

    const { data, error } = await supabase
      .from('option_set_groups')
      .insert({
        option_set_id: setId,
        code,
        label,
        is_required: isRequired,
        display_order: resolvedDisplayOrder ?? 0,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[option-set-groups] failed creating group', error);
      const message = error.code === '23505'
        ? 'An option group with this code already exists for the set'
        : 'Failed to create option group';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({
      option_set_group: {
        option_set_group_id: Number(data.option_set_group_id),
        option_set_id: Number(data.option_set_id),
        code: data.code,
        label: data.label,
        display_order: Number(data.display_order ?? 0),
        is_required: Boolean(data.is_required),
        values: [] as any[],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[option-set-groups] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating option group' }, { status: 500 });
  }
}
