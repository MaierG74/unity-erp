import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type RouteParams = {
  productId?: string;
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
  const productId = parseId(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase
      .from('product_overhead_costs')
      .select(`
        id,
        product_id,
        element_id,
        quantity,
        override_value,
        created_at,
        overhead_cost_elements (
          element_id,
          code,
          name,
          description,
          cost_type,
          default_value,
          percentage_basis,
          is_active
        )
      `)
      .eq('product_id', productId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[product-overhead] failed loading overhead costs', error);
      return NextResponse.json({ error: 'Failed to load product overhead costs' }, { status: 500 });
    }

    const items = (data ?? []).map(row => {
      const element = row.overhead_cost_elements as any;
      return {
        id: Number(row.id),
        product_id: Number(row.product_id),
        element_id: Number(row.element_id),
        quantity: Number(row.quantity),
        override_value: row.override_value != null ? Number(row.override_value) : null,
        created_at: row.created_at,
        element: element ? {
          element_id: Number(element.element_id),
          code: element.code,
          name: element.name,
          description: element.description ?? null,
          cost_type: element.cost_type as 'fixed' | 'percentage',
          default_value: Number(element.default_value),
          percentage_basis: element.percentage_basis as 'materials' | 'labor' | 'total' | null,
          is_active: Boolean(element.is_active),
        } : null,
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error('[product-overhead] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading product overhead costs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const element_id = parseId(String(body.element_id));
  if (!element_id) {
    return NextResponse.json({ error: 'element_id is required' }, { status: 400 });
  }

  const quantity = typeof body.quantity === 'number' && body.quantity > 0 ? body.quantity : 1;
  const override_value = typeof body.override_value === 'number' ? body.override_value : null;

  const supabase = getSupabaseAdmin();

  try {
    // Verify product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('product_id')
      .eq('product_id', productId)
      .maybeSingle();

    if (productError) {
      console.error('[product-overhead] product lookup failed', productError);
      return NextResponse.json({ error: 'Failed to verify product' }, { status: 500 });
    }

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Verify element exists and is active
    const { data: element, error: elementError } = await supabase
      .from('overhead_cost_elements')
      .select('element_id, is_active')
      .eq('element_id', element_id)
      .maybeSingle();

    if (elementError) {
      console.error('[product-overhead] element lookup failed', elementError);
      return NextResponse.json({ error: 'Failed to verify overhead cost element' }, { status: 500 });
    }

    if (!element) {
      return NextResponse.json({ error: 'Overhead cost element not found' }, { status: 404 });
    }

    if (!element.is_active) {
      return NextResponse.json({ error: 'Cannot assign inactive overhead cost element' }, { status: 400 });
    }

    // Insert or update (upsert)
    const { data, error } = await supabase
      .from('product_overhead_costs')
      .upsert({
        product_id: productId,
        element_id,
        quantity,
        override_value,
      }, {
        onConflict: 'product_id,element_id',
      })
      .select(`
        id,
        product_id,
        element_id,
        quantity,
        override_value,
        created_at,
        overhead_cost_elements (
          element_id,
          code,
          name,
          description,
          cost_type,
          default_value,
          percentage_basis,
          is_active
        )
      `)
      .single();

    if (error) {
      console.error('[product-overhead] failed adding overhead cost', error);
      return NextResponse.json({ error: 'Failed to add overhead cost to product' }, { status: 500 });
    }

    const elem = data.overhead_cost_elements as any;
    return NextResponse.json({
      item: {
        id: Number(data.id),
        product_id: Number(data.product_id),
        element_id: Number(data.element_id),
        quantity: Number(data.quantity),
        override_value: data.override_value != null ? Number(data.override_value) : null,
        created_at: data.created_at,
        element: elem ? {
          element_id: Number(elem.element_id),
          code: elem.code,
          name: elem.name,
          description: elem.description ?? null,
          cost_type: elem.cost_type as 'fixed' | 'percentage',
          default_value: Number(elem.default_value),
          percentage_basis: elem.percentage_basis as 'materials' | 'labor' | 'total' | null,
          is_active: Boolean(elem.is_active),
        } : null,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[product-overhead] unexpected create error', error);
    return NextResponse.json({ error: 'Unexpected error while adding overhead cost' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const params = await context.params;
  const productId = parseId(params.productId);
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });
  }

  const url = new URL(request.url);
  const elementId = parseId(url.searchParams.get('element_id') ?? '');

  if (!elementId) {
    return NextResponse.json({ error: 'element_id query parameter is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    const { error } = await supabase
      .from('product_overhead_costs')
      .delete()
      .eq('product_id', productId)
      .eq('element_id', elementId);

    if (error) {
      console.error('[product-overhead] failed removing overhead cost', error);
      return NextResponse.json({ error: 'Failed to remove overhead cost from product' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[product-overhead] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while removing overhead cost' }, { status: 500 });
  }
}
