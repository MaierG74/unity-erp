import { NextRequest, NextResponse } from 'next/server';
import {
  optionSetGroupBelongsToSet,
  parsePositiveInt,
  requireProductsAccess,
} from '@/lib/api/products-access';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  setId?: string;
  groupId?: string;
};

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const setId = parsePositiveInt(params.setId);
  const groupId = parsePositiveInt(params.groupId);
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

  try {
    const groupBelongs = await optionSetGroupBelongsToSet(setId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option group not found for set' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
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
  } catch (error) {
    console.error('[option-set-groups] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating option group' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(_request);
  if ('error' in auth) return auth.error;

  const params = await context.params;
  const setId = parsePositiveInt(params.setId);
  const groupId = parsePositiveInt(params.groupId);
  if (!setId || !groupId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  try {
    const groupBelongs = await optionSetGroupBelongsToSet(setId, groupId);
    if (!groupBelongs) {
      return NextResponse.json({ error: 'Option group not found for set' }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from('option_set_groups')
      .delete()
      .eq('option_set_group_id', groupId);

    if (error) {
      console.error('[option-set-groups] failed deleting group', error);
      return NextResponse.json({ error: 'Failed to delete option group' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[option-set-groups] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting option group' }, { status: 500 });
  }
}
