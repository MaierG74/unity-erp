import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Apply a sub-product's BOM to a parent product by copying its BOM rows
// Also copies Bill of Labour rows, scaling quantities by the same factor.
// Body: { sub_product_id: number, quantity?: number }
export async function POST(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await context.params
    const parentProductId = Number(productId)
    if (!Number.isFinite(parentProductId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }

    const { sub_product_id, quantity = 1 } = await req.json()
    const subProductId = Number(sub_product_id)
    const scale = Number(quantity)

    if (!Number.isFinite(subProductId) || subProductId <= 0) {
      return NextResponse.json({ error: 'sub_product_id is required' }, { status: 400 })
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 })
    }
    if (subProductId === parentProductId) {
      return NextResponse.json({ error: 'Cannot apply a product to itself' }, { status: 400 })
    }

    const supabase = admin()

    // Fetch the sub-product's BOM rows
    const { data: childBom, error: bomErr } = await supabase
      .from('billofmaterials')
      .select('component_id, quantity_required, supplier_component_id')
      .eq('product_id', subProductId)

    if (bomErr) throw bomErr

    if (!childBom || childBom.length === 0) {
      return NextResponse.json({ added: 0, message: 'Selected product has no BOM items' })
    }

    // Prepare insert rows, scaling quantities
    const rows = childBom.map((row: any) => ({
      product_id: parentProductId,
      component_id: row.component_id,
      quantity_required: Number(row.quantity_required) * scale,
      // Keep supplier reference if present for costing
      supplier_component_id: row.supplier_component_id ?? null,
    }))

    // Insert all BOM rows
    const { error: insBomErr } = await supabase.from('billofmaterials').insert(rows)
    if (insBomErr) throw insBomErr

    // Fetch the sub-product's BOL rows
    const { data: childBol, error: bolErr } = await supabase
      .from('billoflabour')
      .select('job_id, time_required, time_unit, quantity, rate_id, pay_type, piece_rate_id, hourly_rate_id')
      .eq('product_id', subProductId)

    if (bolErr) throw bolErr

    let bolAdded = 0
    if (childBol && childBol.length > 0) {
      const today = new Date().toISOString().split('T')[0]

      const resultRows: any[] = []
      for (const row of childBol) {
        let pieceRateId: number | null = row.piece_rate_id ?? null
        let hourlyRateId: number | null = row.hourly_rate_id ?? null
        const payType = (row.pay_type || 'hourly') as 'hourly' | 'piece'

        if (payType === 'piece') {
          // Resolve piece rate for the PARENT product (prefer product-specific, else job default)
          const { data: prates, error: prErr } = await supabase
            .from('piece_work_rates')
            .select('rate_id, product_id, effective_date, end_date')
            .eq('job_id', row.job_id)
            .lte('effective_date', today)
            .or(`end_date.is.null,end_date.gte.${today}`)
            .order('effective_date', { ascending: false })
          if (prErr) throw prErr
          const chosen = (prates || []).find((r: any) => r.product_id === parentProductId) || (prates || []).find((r: any) => r.product_id == null) || null
          pieceRateId = chosen ? chosen.rate_id : null
        } else {
          // Resolve latest hourly rate for this job
          const { data: hrates, error: hErr } = await supabase
            .from('job_hourly_rates')
            .select('rate_id, effective_date, end_date')
            .eq('job_id', row.job_id)
            .lte('effective_date', today)
            .or(`end_date.is.null,end_date.gte.${today}`)
            .order('effective_date', { ascending: false })
            .limit(1)
          if (hErr) throw hErr
          hourlyRateId = hrates && hrates.length > 0 ? hrates[0].rate_id : null
        }

        resultRows.push({
          product_id: parentProductId,
          job_id: row.job_id,
          time_required: row.time_required,
          time_unit: row.time_unit || 'hours',
          quantity: Number(row.quantity || 1) * scale,
          rate_id: row.rate_id ?? null, // legacy fallback
          pay_type: payType,
          piece_rate_id: pieceRateId,
          hourly_rate_id: hourlyRateId,
        })
      }

      if (resultRows.length > 0) {
        const { error: insBolErr } = await supabase.from('billoflabour').insert(resultRows)
        if (insBolErr) throw insBolErr
        bolAdded = resultRows.length
      }
    }

    return NextResponse.json({ addedBom: rows.length, addedBol: bolAdded })
  } catch (err: any) {
    console.error('apply-product error:', err)
    return NextResponse.json({ error: 'Failed to apply product BOM' }, { status: 500 })
  }
}
