import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type RouteParams = { params: { productId: string } }

function parseProductId(id: string | undefined): number | null {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const productId = parseProductId(params?.productId)
  if (!productId) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { quantity?: number | string; location?: string | null }
  const quantity = Number(body?.quantity)
  const location = (body?.location ?? null) as string | null

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'Quantity must be a positive number' }, { status: 400 })
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // Prefer a primary/null-location row if no location provided
    let query = supabaseAdmin
      .from('product_inventory')
      .select('product_inventory_id, quantity_on_hand, location')
      .eq('product_id', productId)

    if (location === null) {
      // @ts-expect-error supabase-js types for .is(null)
      query = query.is('location', null)
    } else {
      query = query.eq('location', location)
    }

    const { data: invRows, error: invErr } = await query.limit(1)
    if (invErr) throw invErr

    if (invRows && invRows.length > 0) {
      const row = invRows[0]
      const current = Number(row?.quantity_on_hand ?? 0)
      const newQty = current + quantity
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('product_inventory')
        .update({ quantity_on_hand: newQty })
        .eq('product_inventory_id', row.product_inventory_id)
        .select('product_inventory_id, product_id, quantity_on_hand, location')
        .single()
      if (updErr) throw updErr
      return NextResponse.json({ success: true, product_id: productId, location, quantity_added: quantity, new_on_hand: Number(updated?.quantity_on_hand ?? newQty) })
    }

    // Insert new inventory row
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('product_inventory')
      .insert({ product_id: productId, quantity_on_hand: quantity, location })
      .select('product_inventory_id, product_id, quantity_on_hand, location')
      .single()
    if (insErr) throw insErr

    return NextResponse.json({ success: true, product_id: productId, location, quantity_added: quantity, new_on_hand: Number(inserted?.quantity_on_hand ?? quantity) })
  } catch (e: any) {
    console.error('[add-fg]', e)
    return NextResponse.json({ error: e?.message || 'Unexpected error while adding finished goods' }, { status: 500 })
  }
}
