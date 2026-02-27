import { NextRequest, NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/api/module-access'
import { MODULE_KEYS } from '@/lib/modules/keys'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

type DirectBolRow = {
  bol_id?: number
  job_id: number
  time_required: number | null
  time_unit: 'hours' | 'minutes' | 'seconds'
  quantity: number
  pay_type?: 'hourly' | 'piece'
  rate_id?: number | null
  piece_rate_id?: number | null
  hourly_rate_id?: number | null
}

// Returns Effective BOL: explicit rows for the product + attached sub-products' BOL scaled
export async function GET(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

  try {
    const { productId: productIdParam } = await context.params
    const productId = Number(productIdParam)
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }
    const url = new URL(req.url)
    const debug = url.searchParams.get('debug') === '1'
    const today = new Date().toISOString().split('T')[0]

    const { data: product, error: productErr } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle()

    if (productErr || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // helper: resolve piece rate as of today for parent product
    async function resolvePieceRate(jobId: number): Promise<number | null> {
      const { data, error } = await supabaseAdmin
        .from('piece_work_rates')
        .select('rate_id, rate, product_id, effective_date, end_date')
        .eq('job_id', jobId)
        .lte('effective_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order('effective_date', { ascending: false })
      if (error) throw error
      const chosen = (data || []).find((r: any) => r.product_id === productId) || (data || []).find((r: any) => r.product_id == null) || null
      return chosen ? Number(chosen.rate) : null
    }

    // helper: resolve hourly rate as of today
    async function resolveHourlyRate(jobId: number): Promise<number | null> {
      const { data, error } = await supabaseAdmin
        .from('job_hourly_rates')
        .select('rate_id, hourly_rate, effective_date, end_date')
        .eq('job_id', jobId)
        .lte('effective_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order('effective_date', { ascending: false })
        .limit(1)
      if (error) throw error
      if (data && data.length > 0) return Number(data[0].hourly_rate)

      // Fallback: use the job category's current_hourly_rate
      const { data: jobRow } = await supabaseAdmin
        .from('jobs')
        .select('job_categories(current_hourly_rate)')
        .eq('job_id', jobId)
        .maybeSingle()
      const catRate = (jobRow as any)?.job_categories?.current_hourly_rate
      return catRate != null ? Number(catRate) : null
    }

    async function inflateDirect(rows: DirectBolRow[], source: 'direct' | 'link', scale = 1, subProductId?: number) {
      const out: any[] = []
      for (const r of rows) {
        const payType = (r.pay_type || 'hourly') as 'hourly' | 'piece'
        let hourlyRate: number | null = null
        let pieceRate: number | null = null

        if (payType === 'piece') {
          if (r.piece_rate_id) {
            const { data } = await supabaseAdmin.from('piece_work_rates').select('rate').eq('rate_id', r.piece_rate_id).maybeSingle()
            pieceRate = data ? Number((data as any).rate) : await resolvePieceRate(r.job_id)
          } else {
            pieceRate = await resolvePieceRate(r.job_id)
          }
        } else {
          if (r.hourly_rate_id) {
            const { data } = await supabaseAdmin.from('job_hourly_rates').select('hourly_rate').eq('rate_id', r.hourly_rate_id).maybeSingle()
            hourlyRate = data ? Number((data as any).hourly_rate) : await resolveHourlyRate(r.job_id)
          } else {
            hourlyRate = await resolveHourlyRate(r.job_id)
          }
        }

        // Fetch job + category labels
        const { data: jobRow } = await supabaseAdmin
          .from('jobs')
          .select('name, job_categories(name)')
          .eq('job_id', r.job_id)
          .maybeSingle()

        out.push({
          bol_id: source === 'direct' ? (r.bol_id ?? null) : null,
          job_id: r.job_id,
          job_name: (jobRow as any)?.name || String(r.job_id),
          category_name: (jobRow as any)?.job_categories?.name || '',
          pay_type: payType,
          time_required: r.time_required,
          time_unit: r.time_unit || 'hours',
          quantity: Number(r.quantity || 1) * Number(scale || 1),
          hourly_rate: hourlyRate,
          piece_rate: pieceRate,
          _source: source,
          _sub_product_id: subProductId ?? null,
          _editable: source === 'direct',
        })
      }
      return out
    }

    // Direct rows
    const { data: directRows, error: directErr } = await supabaseAdmin
      .from('billoflabour')
      .select('bol_id, job_id, time_required, time_unit, quantity, pay_type, rate_id, piece_rate_id, hourly_rate_id')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
    if (directErr) throw directErr

    const directInflated = await inflateDirect((directRows as DirectBolRow[]) || [], 'direct')

    // Links
    const { data: links, error: linkErr } = await supabaseAdmin
      .from('product_bom_links')
      .select('sub_product_id, scale')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
    if (linkErr) throw linkErr

    const linkedOut: any[] = []
    for (const link of links || []) {
      const { data: subBol, error: subErr } = await supabaseAdmin
        .from('billoflabour')
        .select('job_id, time_required, time_unit, quantity, pay_type')
        .eq('product_id', link.sub_product_id)
        .eq('org_id', auth.orgId)
      if (subErr) throw subErr
      const expanded = await inflateDirect((subBol as DirectBolRow[]) || [], 'link', Number(link.scale || 1), link.sub_product_id)
      linkedOut.push(...expanded)
    }

    const items = [...directInflated, ...linkedOut]

    if (debug) {
      return NextResponse.json({
        items,
        meta: { direct_count: directInflated.length, links_count: (links || []).length, total: items.length }
      })
    }

    return NextResponse.json({ items })
  } catch (err) {
    console.error('effective-bol error:', err)
    return NextResponse.json({ error: 'Failed to compute effective BOL' }, { status: 500 })
  }
}
