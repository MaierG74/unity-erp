import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Create an Attach link (phantom, single-level)
export async function POST(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const parentProductId = Number(params.productId)
    if (!Number.isFinite(parentProductId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }

    const { sub_product_id, scale = 1, mode = 'phantom' } = await req.json()
    const subProductId = Number(sub_product_id)
    const scaleNum = Number(scale)

    if (!Number.isFinite(subProductId) || subProductId <= 0) {
      return NextResponse.json({ error: 'sub_product_id is required' }, { status: 400 })
    }
    if (subProductId === parentProductId) {
      return NextResponse.json({ error: 'Cannot attach a product to itself' }, { status: 400 })
    }
    if (!Number.isFinite(scaleNum) || scaleNum <= 0) {
      return NextResponse.json({ error: 'scale must be a positive number' }, { status: 400 })
    }
    if (mode !== 'phantom') {
      return NextResponse.json({ error: 'Only phantom mode is supported in Phase A' }, { status: 400 })
    }

    const supabase = admin()

    // Ensure both products exist
    const { data: parent, error: parentErr } = await supabase
      .from('products')
      .select('product_id')
      .eq('product_id', parentProductId)
      .single()
    if (parentErr || !parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })

    const { data: sub, error: subErr } = await supabase
      .from('products')
      .select('product_id')
      .eq('product_id', subProductId)
      .single()
    if (subErr || !sub) return NextResponse.json({ error: 'Sub product not found' }, { status: 404 })

    // Upsert link
    const { error: insErr } = await supabase
      .from('product_bom_links')
      .upsert({ product_id: parentProductId, sub_product_id: subProductId, scale: scaleNum, mode: 'phantom' })
    if (insErr) throw insErr

    return NextResponse.json({ attached: true })
  } catch (err) {
    console.error('attach-product error:', err)
    return NextResponse.json({ error: 'Failed to attach product' }, { status: 500 })
  }
}

// Detach link
export async function DELETE(req: NextRequest, { params }: { params: { productId: string } }) {
  try {
    const url = new URL(req.url)
    const subIdParam = url.searchParams.get('sub_product_id')
    const parentProductId = Number(params.productId)
    const subProductId = Number(subIdParam)
    if (!Number.isFinite(parentProductId) || !Number.isFinite(subProductId)) {
      return NextResponse.json({ error: 'Invalid productId or sub_product_id' }, { status: 400 })
    }
    const supabase = admin()
    const { error } = await supabase
      .from('product_bom_links')
      .delete()
      .eq('product_id', parentProductId)
      .eq('sub_product_id', subProductId)
    if (error) throw error
    return NextResponse.json({ detached: true })
  } catch (err) {
    console.error('detach-product error:', err)
    return NextResponse.json({ error: 'Failed to detach product' }, { status: 500 })
  }
}

