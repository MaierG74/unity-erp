import { NextRequest, NextResponse } from 'next/server'
import {
  parsePositiveInt,
  productExistsInOrg,
  requireProductsAccess,
  validateOrgScopedComponentRefs,
} from '@/lib/api/products-access'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

  try {
    const { productId: productIdParam } = await context.params
    const productId = parsePositiveInt(productIdParam)
    if (!productId) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }

    const { collection_id, scale = 1 }: { collection_id: number; scale?: number } = await req.json()
    if (!collection_id || scale <= 0) {
      return NextResponse.json({ error: 'collection_id and positive scale are required' }, { status: 400 })
    }

    const productExists = await productExistsInOrg(productId, auth.orgId)
    if (!productExists) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Read collection header for version provenance
    const { data: collection, error: collErr } = await supabaseAdmin
      .from('bom_collections')
      .select('collection_id, version')
      .eq('collection_id', collection_id)
      .single()
    if (collErr || !collection) throw collErr || new Error('Collection not found')

    // Read items
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('bom_collection_items')
      .select('component_id, quantity_required, supplier_component_id')
      .eq('collection_id', collection_id)
    if (itemsErr) throw itemsErr

    if (!items || items.length === 0) {
      return NextResponse.json({ added: 0, message: 'Collection has no items' })
    }

    const refError = await validateOrgScopedComponentRefs(
      auth.orgId,
      items.map((item) => ({
        componentId: item.component_id,
        supplierComponentId: item.supplier_component_id ?? null,
      }))
    )
    if (refError) {
      return NextResponse.json({ error: refError }, { status: 400 })
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

    const { error: insErr } = await supabaseAdmin.from('billofmaterials').insert(rows)
    if (insErr) throw insErr

    return NextResponse.json({ added: rows.length })
  } catch (err: any) {
    console.error('apply-collection error:', err)
    return NextResponse.json({ error: 'Failed to apply collection' }, { status: 500 })
  }
}
