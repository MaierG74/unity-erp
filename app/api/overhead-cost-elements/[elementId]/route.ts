import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  elementId?: string;
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

async function fetchElement(elementId: number) {
  const supabase = getSupabaseAdmin();
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
    .eq('element_id', elementId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const category = data.overhead_categories as { category_id: number; name: string; description: string | null; is_active: boolean; display_order: number } | null;

  return {
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
    usage_count: Array.isArray(data.product_overhead_costs)
      ? Number(data.product_overhead_costs[0]?.count ?? 0)
      : 0,
  };
}

export async function GET(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const elementId = parseId(params.elementId);
  if (!elementId) {
    return NextResponse.json({ error: 'Invalid element id' }, { status: 400 });
  }

  try {
    const element = await fetchElement(elementId);
    if (!element) {
      return NextResponse.json({ error: 'Overhead cost element not found' }, { status: 404 });
    }

    return NextResponse.json({ element });
  } catch (error) {
    console.error('[overhead-cost-elements] failed loading element', error);
    return NextResponse.json({ error: 'Failed to load overhead cost element' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const elementId = parseId(params.elementId);
  if (!elementId) {
    return NextResponse.json({ error: 'Invalid element id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.code === 'string') {
    const code = body.code.trim();
    if (!code) return NextResponse.json({ error: 'Code cannot be empty' }, { status: 400 });
    updates.code = code;
  }

  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    updates.name = name;
  }

  if (typeof body.description === 'string') {
    updates.description = body.description.trim();
  } else if (body.description === null) {
    updates.description = null;
  }

  if (body.cost_type === 'fixed' || body.cost_type === 'percentage') {
    updates.cost_type = body.cost_type;
  }

  if (typeof body.default_value === 'number') {
    updates.default_value = body.default_value;
  }

  if (body.percentage_basis === 'materials' || body.percentage_basis === 'labor' || body.percentage_basis === 'total') {
    updates.percentage_basis = body.percentage_basis;
  } else if (body.percentage_basis === null) {
    updates.percentage_basis = null;
  }

  if (typeof body.is_active === 'boolean') {
    updates.is_active = body.is_active;
  }

  if (typeof body.category_id === 'number') {
    updates.category_id = body.category_id;
  } else if (body.category_id === null) {
    updates.category_id = null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { error } = await supabase
      .from('overhead_cost_elements')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('element_id', elementId);

    if (error) {
      console.error('[overhead-cost-elements] failed updating element', error);
      const message = error.code === '23505'
        ? 'Another overhead cost element already uses that code'
        : 'Failed to update overhead cost element';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const refreshed = await fetchElement(elementId);
    if (!refreshed) {
      return NextResponse.json({ error: 'Overhead cost element not found after update' }, { status: 404 });
    }

    return NextResponse.json({ element: refreshed });
  } catch (error) {
    console.error('[overhead-cost-elements] unexpected update error', error);
    return NextResponse.json({ error: 'Unexpected error while updating overhead cost element' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const elementId = parseId(params.elementId);
  if (!elementId) {
    return NextResponse.json({ error: 'Invalid element id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    // Check if element is in use by any products
    const { data: usageRows, error: usageError } = await supabase
      .from('product_overhead_costs')
      .select('id')
      .eq('element_id', elementId)
      .limit(1);

    if (usageError) {
      console.error('[overhead-cost-elements] usage check failed', usageError);
      return NextResponse.json({ error: 'Failed to verify element usage' }, { status: 500 });
    }

    if (usageRows && usageRows.length > 0) {
      return NextResponse.json({
        error: 'This overhead cost element is assigned to products and cannot be deleted'
      }, { status: 409 });
    }

    const { error } = await supabase
      .from('overhead_cost_elements')
      .delete()
      .eq('element_id', elementId);

    if (error) {
      console.error('[overhead-cost-elements] failed deleting element', error);
      return NextResponse.json({ error: 'Failed to delete overhead cost element' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[overhead-cost-elements] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting overhead cost element' }, { status: 500 });
  }
}
