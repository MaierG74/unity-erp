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
      .from('overhead_cost_elements')
      .select(`
        element_id,
        code,
        name,
        description,
        cost_type,
        default_value,
        percentage_basis,
        is_active,
        created_at,
        updated_at,
        category_id,
        overhead_categories (
          category_id,
          name,
          description,
          is_active,
          display_order
        ),
        product_overhead_costs(count)
      `)
      .order('name', { ascending: true });

    if (error) {
      console.error('[overhead-cost-elements] failed loading elements', error);
      return NextResponse.json({ error: 'Failed to load overhead cost elements' }, { status: 500 });
    }

    const elements = (data ?? []).map(element => {
      const category = element.overhead_categories as { category_id: number; name: string; description: string | null; is_active: boolean; display_order: number } | null;
      return {
        element_id: Number(element.element_id),
        code: element.code,
        name: element.name,
        description: element.description ?? null,
        cost_type: element.cost_type as 'fixed' | 'percentage',
        default_value: Number(element.default_value),
        percentage_basis: element.percentage_basis as 'materials' | 'labor' | 'total' | null,
        is_active: Boolean(element.is_active),
        created_at: element.created_at,
        updated_at: element.updated_at,
        category_id: element.category_id ? Number(element.category_id) : null,
        category: category ? {
          category_id: Number(category.category_id),
          name: category.name,
          description: category.description,
          is_active: Boolean(category.is_active),
          display_order: Number(category.display_order),
        } : null,
        usage_count: Array.isArray(element.product_overhead_costs)
          ? Number(element.product_overhead_costs[0]?.count ?? 0)
          : 0,
      };
    });

    return NextResponse.json({ elements });
  } catch (error) {
    console.error('[overhead-cost-elements] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading overhead cost elements' }, { status: 500 });
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
  const cost_type = body.cost_type === 'percentage' ? 'percentage' : 'fixed';
  const default_value = typeof body.default_value === 'number' ? body.default_value : 0;
  const percentage_basis = cost_type === 'percentage'
    ? (body.percentage_basis === 'materials' || body.percentage_basis === 'labor' || body.percentage_basis === 'total'
        ? body.percentage_basis
        : 'total')
    : null;
  const is_active = body.is_active !== false;
  const category_id = typeof body.category_id === 'number' ? body.category_id : null;

  if (!code) {
    return NextResponse.json({ error: 'Code is required' }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('overhead_cost_elements')
      .insert({
        code,
        name,
        description,
        cost_type,
        default_value,
        percentage_basis,
        is_active,
        category_id,
      })
      .select(`
        *,
        overhead_categories (
          category_id,
          name,
          description,
          is_active,
          display_order
        )
      `)
      .single();

    if (error) {
      console.error('[overhead-cost-elements] failed creating element', error);
      const message = error.code === '23505'
        ? 'An overhead cost element with this code already exists'
        : 'Failed to create overhead cost element';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const category = data.overhead_categories as { category_id: number; name: string; description: string | null; is_active: boolean; display_order: number } | null;
    return NextResponse.json({
      element: {
        element_id: Number(data.element_id),
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        cost_type: data.cost_type as 'fixed' | 'percentage',
        default_value: Number(data.default_value),
        percentage_basis: data.percentage_basis as 'materials' | 'labor' | 'total' | null,
        is_active: Boolean(data.is_active),
        created_at: data.created_at,
        updated_at: data.updated_at,
        category_id: data.category_id ? Number(data.category_id) : null,
        category: category ? {
          category_id: Number(category.category_id),
          name: category.name,
          description: category.description,
          is_active: Boolean(category.is_active),
          display_order: Number(category.display_order),
        } : null,
        usage_count: 0,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[overhead-cost-elements] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while creating overhead cost element' }, { status: 500 });
  }
}
