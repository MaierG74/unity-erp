import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const productId = Number(params.productId)
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }

    const { collection_id, scale = 1 }: { collection_id: number; scale?: number } = await req.json()
    if (!collection_id || scale <= 0) {
      return NextResponse.json({ error: 'collection_id and positive scale are required' }, { status: 400 })
    }

    const supabase = admin()

    // Read collection header for version provenance
    const { data: collection, error: collErr } = await supabase
      .from('bom_collections')
      .select('collection_id, version')
      .eq('collection_id', collection_id)
      .single()
    if (collErr || !collection) throw collErr || new Error('Collection not found')

    // Read items
    const { data: items, error: itemsErr } = await supabase
      .from('bom_collection_items')
      .select('component_id, quantity_required, supplier_component_id')
      .eq('collection_id', collection_id)
    if (itemsErr) throw itemsErr

    if (!items || items.length === 0) {
      return NextResponse.json({ added: 0, message: 'Collection has no items' })
    }

    // Prepare rows to insert (apply copy). Merge-by-summing is a later enhancement.
    const rows = items.map((it) => ({
      product_id: productId,
      component_id: it.component_id,
      quantity_required: Number(it.quantity_required) * Number(scale || 1),
      supplier_component_id: it.supplier_component_id ?? null,
      source_collection_id: collection.collection_id,
      source_collection_version: collection.version,
      overridden: false,
    }))

    const { error: insErr } = await supabase.from('billofmaterials').insert(rows)
    if (insErr) throw insErr

    return NextResponse.json({ added: rows.length })
  } catch (err: any) {
    console.error('apply-collection error:', err)
    return NextResponse.json({ error: 'Failed to apply collection' }, { status: 500 })
  }
}

