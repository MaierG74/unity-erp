import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  categoryId?: string;
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

export async function GET(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const categoryId = parseId(params.categoryId);
  if (!categoryId) {
    return NextResponse.json({ error: 'Invalid category id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('overhead_categories')
      .select('*')
      .eq('category_id', categoryId)
      .maybeSingle();

    if (error) {
      console.error('[overhead-categories] failed loading category', error);
      return NextResponse.json({ error: 'Failed to load overhead category' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('[overhead-categories] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading overhead category' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const categoryId = parseId(params.categoryId);
  if (!categoryId) {
    return NextResponse.json({ error: 'Invalid category id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    }
    updates.name = body.name.trim();
  }

  if (body.description !== undefined) {
    updates.description = body.description?.trim() || null;
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  if (body.display_order !== undefined) {
    updates.display_order = typeof body.display_order === 'number' ? body.display_order : 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('overhead_categories')
      .update(updates)
      .eq('category_id', categoryId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 });
      }
      console.error('[overhead-categories] failed updating category', error);
      return NextResponse.json({ error: 'Failed to update overhead category' }, { status: 500 });
    }

    return NextResponse.json({ item: data });
  } catch (error) {
    console.error('[overhead-categories] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating overhead category' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const categoryId = parseId(params.categoryId);
  if (!categoryId) {
    return NextResponse.json({ error: 'Invalid category id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    // Check if any elements are using this category
    const { count, error: countError } = await supabase
      .from('overhead_cost_elements')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if (countError) {
      console.error('[overhead-categories] failed checking category usage', countError);
      return NextResponse.json({ error: 'Failed to check category usage' }, { status: 500 });
    }

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete category: ${count} overhead element(s) are using it` },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from('overhead_categories')
      .delete()
      .eq('category_id', categoryId);

    if (error) {
      console.error('[overhead-categories] failed deleting category', error);
      return NextResponse.json({ error: 'Failed to delete overhead category' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[overhead-categories] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting overhead category' }, { status: 500 });
  }
}
