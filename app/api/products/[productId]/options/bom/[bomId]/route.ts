import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: {
    productId?: string;
    bomId?: string;
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

async function ensureBomBelongsToProduct(client: ReturnType<typeof createClient>, productId: number, bomId: number) {
  const { data, error } = await client
    .from('billofmaterials')
    .select('product_id')
    .eq('bom_id', bomId)
    .single();

  if (error || !data || Number(data.product_id) !== productId) {
    throw new Error('Not found');
  }
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const bomId = parseId(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureBomBelongsToProduct(supabase, productId, bomId);

    const { data: groupsData, error: groupsError } = await supabase
      .from('product_option_groups')
      .select(`
        option_group_id,
        product_id,
        code,
        label,
        display_order,
        is_required,
        product_option_values (
          option_value_id,
          option_group_id,
          code,
          label,
          is_default,
          display_order,
          attributes
        )
      `)
      .eq('product_id', productId)
      .order('display_order', { ascending: true });

    if (groupsError) {
      console.error('[bom-overrides] failed loading groups', groupsError);
      return NextResponse.json({ error: 'Failed to load option groups' }, { status: 500 });
    }

    const { data: overridesData, error: overridesError } = await supabase
      .from('bom_option_overrides')
      .select('*')
      .eq('bom_id', bomId);

    if (overridesError) {
      console.error('[bom-overrides] failed loading overrides', overridesError);
      return NextResponse.json({ error: 'Failed to load overrides' }, { status: 500 });
    }

    return NextResponse.json({
      groups: groupsData ?? [],
      overrides: overridesData ?? [],
    });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }
    console.error('[bom-overrides] unexpected error', error);
    return NextResponse.json({ error: 'Unexpected error while loading overrides' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const bomId = parseId(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const optionValueId = parseId(String(payload.option_value_id ?? ''));
  if (!optionValueId) {
    return NextResponse.json({ error: 'option_value_id is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureBomBelongsToProduct(supabase, productId, bomId);

  const cutlistDimensions = payload.cutlist_dimensions;
  const attributes = payload.attributes;

  const upsertData: Record<string, any> = {
      bom_id: bomId,
      option_value_id: optionValueId,
      replace_component_id: payload.replace_component_id ?? null,
      replace_supplier_component_id: payload.replace_supplier_component_id ?? null,
      quantity_delta: payload.quantity_delta ?? null,
      notes: typeof payload.notes === 'string' ? payload.notes : null,
      is_cutlist_item: typeof payload.is_cutlist_item === 'boolean' ? payload.is_cutlist_item : null,
      cutlist_category: typeof payload.cutlist_category === 'string' ? payload.cutlist_category : null,
      cutlist_dimensions: cutlistDimensions && typeof cutlistDimensions === 'object' ? cutlistDimensions : null,
      attributes: attributes && typeof attributes === 'object' ? attributes : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('bom_option_overrides')
      .upsert(upsertData, { onConflict: 'bom_id,option_value_id' })
      .select('*')
      .single();

    if (error) {
      console.error('[bom-overrides] failed upserting override', error);
      return NextResponse.json({ error: 'Failed to save override' }, { status: 400 });
    }

    return NextResponse.json({ override: data });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }
    console.error('[bom-overrides] unexpected upsert error', error);
    return NextResponse.json({ error: 'Unexpected error while saving override' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const productId = parseId(params.productId);
  const bomId = parseId(params.bomId);
  if (!productId || !bomId) {
    return NextResponse.json({ error: 'Invalid identifiers' }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  const optionValueId = payload ? parseId(String(payload.option_value_id ?? '')) : null;
  if (!optionValueId) {
    return NextResponse.json({ error: 'option_value_id is required' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    await ensureBomBelongsToProduct(supabase, productId, bomId);

    const { error } = await supabase
      .from('bom_option_overrides')
      .delete()
      .eq('bom_id', bomId)
      .eq('option_value_id', optionValueId);

    if (error) {
      console.error('[bom-overrides] failed deleting override', error);
      return NextResponse.json({ error: 'Failed to delete override' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.message === 'Not found') {
      return NextResponse.json({ error: 'BOM row not found for product' }, { status: 404 });
    }
    console.error('[bom-overrides] unexpected delete error', error);
    return NextResponse.json({ error: 'Unexpected error while deleting override' }, { status: 500 });
  }
}
