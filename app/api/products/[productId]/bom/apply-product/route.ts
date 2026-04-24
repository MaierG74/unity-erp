import { NextRequest, NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/api/module-access'
import { MODULE_KEYS } from '@/lib/modules/keys'
import { supabaseAdmin } from '@/lib/supabase-admin'

async function resolveCategoryRateId(jobId: number, today: string): Promise<number | null> {
  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('category_id')
    .eq('job_id', jobId)
    .maybeSingle()

  if (jobError) throw jobError
  if (!job?.category_id) return null

  const { data, error } = await supabaseAdmin
    .from('job_category_rates')
    .select('rate_id')
    .eq('category_id', job.category_id)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false })
    .limit(1)

  if (error) throw error
  return data && data.length > 0 ? Number(data[0].rate_id) : null
}

async function requireProductsAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM, {
    forbiddenMessage: 'Products module access is disabled for your organization',
  })
  if ('error' in access) {
    return { error: access.error }
  }

  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for products access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    }
  }

  return { orgId: access.orgId }
}

// Apply a sub-product's BOM to a parent product by copying its BOM rows
// Also copies Bill of Labour rows, scaling quantities by the same factor.
// Body: { sub_product_id: number, quantity?: number }
export async function POST(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

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

    const { data: parent, error: parentErr } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', parentProductId)
      .eq('org_id', auth.orgId)
      .maybeSingle()
    if (parentErr || !parent) {
      return NextResponse.json({ error: 'Parent product not found' }, { status: 404 })
    }

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', subProductId)
      .eq('org_id', auth.orgId)
      .maybeSingle()
    if (subErr || !sub) {
      return NextResponse.json({ error: 'Sub product not found' }, { status: 404 })
    }

    // Fetch the sub-product's BOM rows
    const { data: childBom, error: bomErr } = await supabaseAdmin
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

    // Fetch the sub-product's BOL rows
    const { data: childBol, error: bolErr } = await supabaseAdmin
      .from('billoflabour')
      .select('job_id, time_required, time_unit, quantity, rate_id, pay_type, piece_rate_id, hourly_rate_id')
      .eq('product_id', subProductId)
      .eq('org_id', auth.orgId)

    if (bolErr) throw bolErr

    // Resolve rates and build BOL insert rows BEFORE any writes, so a 400 on
    // rate resolution cannot leave partial state (e.g. inserted BOM rows with
    // no matching BOL). See billoflabour_pay_pairing_chk: hourly rows must
    // have a non-null legacy rate_id.
    const bolInsertRows: any[] = []
    if (childBol && childBol.length > 0) {
      const today = new Date().toISOString().split('T')[0]

      for (const row of childBol) {
        let pieceRateId: number | null = row.piece_rate_id ?? null
        let hourlyRateId: number | null = row.hourly_rate_id ?? null
        let categoryRateId: number | null = null
        const payType = (row.pay_type || 'hourly') as 'hourly' | 'piece'

        if (payType === 'piece') {
          // Resolve piece rate for the PARENT product (prefer product-specific, else job default)
          const { data: prates, error: prErr } = await supabaseAdmin
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
          const { data: hrates, error: hErr } = await supabaseAdmin
            .from('job_hourly_rates')
            .select('rate_id, effective_date, end_date')
            .eq('job_id', row.job_id)
            .lte('effective_date', today)
            .or(`end_date.is.null,end_date.gte.${today}`)
            .order('effective_date', { ascending: false })
            .limit(1)
          if (hErr) throw hErr
          hourlyRateId = hrates && hrates.length > 0 ? hrates[0].rate_id : null
          // Legacy rate_id is required by billoflabour_pay_pairing_chk for hourly rows.
          categoryRateId = await resolveCategoryRateId(row.job_id, today)
          if (!categoryRateId) {
            return NextResponse.json(
              { error: `No active hourly rate for job ${row.job_id}'s category` },
              { status: 400 },
            )
          }
        }

        bolInsertRows.push({
          product_id: parentProductId,
          job_id: row.job_id,
          time_required: row.time_required,
          time_unit: row.time_unit || 'hours',
          quantity: Number(row.quantity || 1) * scale,
          rate_id: payType === 'hourly' ? categoryRateId : null,
          pay_type: payType,
          piece_rate_id: pieceRateId,
          hourly_rate_id: hourlyRateId,
          org_id: auth.orgId,
        })
      }
    }

    // All resolution succeeded — safe to write. Insert BOM then BOL.
    const { error: insBomErr } = await supabaseAdmin.from('billofmaterials').insert(rows)
    if (insBomErr) throw insBomErr

    let bolAdded = 0
    if (bolInsertRows.length > 0) {
      const { error: insBolErr } = await supabaseAdmin.from('billoflabour').insert(bolInsertRows)
      if (insBolErr) throw insBolErr
      bolAdded = bolInsertRows.length
    }

    return NextResponse.json({ addedBom: rows.length, addedBol: bolAdded })
  } catch (err: any) {
    console.error('apply-product error:', err)
    return NextResponse.json({ error: 'Failed to apply product BOM' }, { status: 500 })
  }
}
