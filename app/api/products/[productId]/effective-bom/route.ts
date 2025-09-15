import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Returns an effective BOM: explicit rows + attached sub-product rows (scaled). Single-level, phantom.
export async function GET(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const productId = Number(params.productId)
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }
    const supabase = admin()
    const url = new URL(req.url)
    const debug = url.searchParams.get('debug') === '1'

    // Explicit BOM rows for this product
    const { data: direct, error: directErr } = await supabase
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

    // Attached sub-products
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

    const all = [
      ...(direct || []).map((r: any) => ({ ...r, _source: 'direct', _editable: true })),
      ...exploded,
    ]

    if (debug) {
      return NextResponse.json({
        items: all,
        meta: {
          direct_count: direct?.length || 0,
          links_count: links?.length || 0,
          exploded_count: exploded.length,
          product_id: productId,
        }
      })
    }

    return NextResponse.json({ items: all })
  } catch (err) {
    console.error('effective-bom error:', err)
    return NextResponse.json({ error: 'Failed to compute effective BOM' }, { status: 500 })
  }
}
