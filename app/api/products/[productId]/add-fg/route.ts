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
    // Read global toggle from settings
    let autoConsume = false
    try {
      const { data: settingsRow } = await supabaseAdmin
        .from('quote_company_settings')
        .select('fg_auto_consume_on_add')
        .eq('setting_id', 1)
        .single()
      autoConsume = Boolean(settingsRow?.fg_auto_consume_on_add)
    } catch {}

    // Prefer a primary/null-location row if no location provided
    let query = supabaseAdmin
      .from('product_inventory')
      .select('product_inventory_id, quantity_on_hand, location')
      .eq('product_id', productId)

    if (location === null) {
      query = query.is('location', null)
    } else {
      query = query.eq('location', location)
    }

    const { data: invRows, error: invErr } = await query.limit(1)
    if (invErr) throw invErr

    let resultPayload: any = { success: true, product_id: productId, location, quantity_added: quantity }

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
      resultPayload.new_on_hand = Number(updated?.quantity_on_hand ?? newQty)
    }

    // If not found, insert a new row
    if (!resultPayload.new_on_hand) {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('product_inventory')
        .insert({ product_id: productId, quantity_on_hand: quantity, location })
        .select('product_inventory_id, product_id, quantity_on_hand, location')
        .single()
      if (insErr) throw insErr
      resultPayload.new_on_hand = Number(inserted?.quantity_on_hand ?? quantity)
    }

    // If auto-consume is enabled, allocate the added quantity against reservations FIFO
    if (autoConsume && quantity > 0) {
      const { data: applied, error: acErr } = await supabaseAdmin.rpc('auto_consume_on_add', {
        p_product_id: productId,
        p_quantity: quantity,
      })
      if (acErr) {
        // Do not fail the whole request; report warning
        resultPayload.auto_consume = { applied: [], warning: acErr.message }
      } else {
        resultPayload.auto_consume = { applied: applied || [] }
      }
    } else {
      resultPayload.auto_consume = { applied: [] }
    }

    return NextResponse.json(resultPayload)
  } catch (e: any) {
    console.error('[add-fg]', e)
    return NextResponse.json({ error: e?.message || 'Unexpected error while adding finished goods' }, { status: 500 })
  }
}

