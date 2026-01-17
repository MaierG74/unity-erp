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
      .from('overhead_categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[overhead-categories] failed loading categories', error);
      return NextResponse.json({ error: 'Failed to load overhead categories' }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (error) {
    console.error('[overhead-categories] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading overhead categories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name, description, is_active, display_order } = body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('overhead_categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        is_active: is_active !== false,
        display_order: typeof display_order === 'number' ? display_order : 0,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 });
      }
      console.error('[overhead-categories] failed creating category', error);
      return NextResponse.json({ error: 'Failed to create overhead category' }, { status: 500 });
    }

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (error) {
    console.error('[overhead-categories] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating overhead category' }, { status: 500 });
  }
}
