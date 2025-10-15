import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type SelectedOptions = Record<string, string>

export async function resolveEffectiveBom(
  supabase: SupabaseClient,
  productId: number,
  selectedOptions: SelectedOptions
) {
  let direct: any[] = []
  const { data: resolved, error: resolvedErr } = await supabase
    .rpc('get_product_components', {
      _product_id: productId,
      _selected_options: selectedOptions,
    })

  if (!resolvedErr && Array.isArray(resolved) && resolved.length > 0) {
    direct = resolved.map((row: any) => ({
      bom_id: row.bom_id ?? null,
      component_id: Number(row.component_id),
      quantity_required: Number(row.quantity ?? row.quantity_required ?? 0),
      supplier_component_id: row.supplier_component_id ?? null,
      suppliercomponents:
        row.supplier_price != null ? { price: Number(row.supplier_price) } : null,
      configuration_scope: row.configuration_scope ?? null,
      option_group_code: row.option_group_code ?? null,
      option_value_code: row.option_value_code ?? null,
      quantity_source: row.quantity_source ?? null,
      notes: row.notes ?? null,
      is_cutlist_item:
        row.is_cutlist_item === null || row.is_cutlist_item === undefined
          ? null
          : Boolean(row.is_cutlist_item),
      cutlist_category: row.cutlist_category ?? null,
      cutlist_dimensions: row.cutlist_dimensions ?? null,
      attributes: row.attributes ?? null,
      component_description: row.component_description ?? null,
      _source: 'rpc',
      _editable: (row.configuration_scope ?? 'base') === 'base',
    }))
  } else {
    if (resolvedErr) {
      console.warn('[effective-bom] get_product_components fallback', resolvedErr)
    }

    const { data: directFallback, error: directErr } = await supabase
      .from('billofmaterials')
      .select(`
        bom_id,
        component_id,
        quantity_required,
        supplier_component_id,
        suppliercomponents(price)
      `)
      .eq('product_id', productId)
    if (directErr) throw directErr

    direct = (directFallback || []).map((r: any) => ({
      ...r,
      _source: 'direct',
      _editable: true,
    }))
  }

  const { data: links, error: linkErr } = await supabase
    .from('product_bom_links')
    .select('sub_product_id, scale, mode')
    .eq('product_id', productId)
  if (linkErr) throw linkErr

  const exploded: any[] = []
  if (links && links.length > 0) {
    for (const link of links) {
      const { data: subRows, error: subErr } = await supabase
        .from('billofmaterials')
        .select(`
          component_id,
          quantity_required,
          supplier_component_id,
          suppliercomponents(price)
        `)
        .eq('product_id', link.sub_product_id)
      if (subErr) throw subErr
      for (const r of subRows || []) {
        exploded.push({
          bom_id: null,
          component_id: r.component_id,
          quantity_required: Number(r.quantity_required) * Number(link.scale || 1),
          supplier_component_id: r.supplier_component_id ?? null,
          suppliercomponents: r.suppliercomponents || null,
          _source: 'link',
          _sub_product_id: link.sub_product_id,
          _editable: false,
        })
      }
    }
  }

  const items = [...(direct || []), ...exploded]

  return {
    items,
    meta: {
      direct_count: direct?.length || 0,
      links_count: links?.length || 0,
      exploded_count: exploded.length,
    },
  }
}

// Returns an effective BOM: explicit rows + attached sub-product rows (scaled). Single-level, phantom.
export async function GET(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const productId = Number(params.productId)
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }
    const supabase = createAdminClient()
    const url = new URL(req.url)
    const debug = url.searchParams.get('debug') === '1'

    const selectedOptionsRaw = url.searchParams.get('selected_options')
    let selectedOptions: Record<string, string> = {}
    if (selectedOptionsRaw) {
      try {
        const parsed = JSON.parse(selectedOptionsRaw)
        if (!parsed || typeof parsed !== 'object') {
          return NextResponse.json({ error: 'Invalid selected_options payload' }, { status: 400 })
        }
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof key === 'string' && key.length > 0 && typeof value === 'string' && value.length > 0) {
            selectedOptions[key] = value
          }
        }
      } catch (parseError) {
        return NextResponse.json({ error: 'Invalid selected_options payload' }, { status: 400 })
      }
    }

    const { items, meta } = await resolveEffectiveBom(supabase, productId, selectedOptions)

    if (debug) {
      return NextResponse.json({
        items,
        meta: {
          ...meta,
          product_id: productId,
        },
      })
    }

    return NextResponse.json({ items })
  } catch (err) {
    console.error('effective-bom error:', err)
    return NextResponse.json({ error: 'Failed to compute effective BOM' }, { status: 500 })
  }
}
