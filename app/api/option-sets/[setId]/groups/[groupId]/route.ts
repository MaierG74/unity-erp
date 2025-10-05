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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  const groupId = parseId(params.groupId);
  if (!setId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.code === 'string') {
    const code = body.code.trim();
    if (!code) return NextResponse.json({ error: 'Group code cannot be empty' }, { status: 400 });
    updates.code = code;
  }
  if (typeof body.label === 'string') {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ error: 'Group label cannot be empty' }, { status: 400 });
    updates.label = label;
  }
  if (typeof body.is_required === 'boolean') {
    updates.is_required = body.is_required;
  }
  if (typeof body.display_order === 'number' && Number.isFinite(body.display_order)) {
    updates.display_order = body.display_order;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureGroupBelongsToSet(supabase, setId, groupId);

    const { error } = await supabase
      .from('option_set_groups')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[option-set-groups] failed updating group', error);
      const message = error.code === '23505'
        ? 'Another group already uses that code'
        : 'Failed to update option group';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option group not found for set' }, { status: 404 });
    }
    console.error('[option-set-groups] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option group' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const setId = parseId(params.setId);
  const groupId = parseId(params.groupId);
  if (!setId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureGroupBelongsToSet(supabase, setId, groupId);

    const { error } = await supabase
      .from('option_set_groups')
      .delete()
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[option-set-groups] failed deleting group', error);
      return NextResponse.json({ error: 'Failed to delete option group' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'Option group not found for set' }, { status: 404 });
    }
    console.error('[option-set-groups] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting option group' }, { status: 500 });
  }
}
