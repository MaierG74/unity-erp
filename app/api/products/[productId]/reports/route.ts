// app/api/products/[productId]/reports/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/api/module-access'
import { MODULE_KEYS } from '@/lib/modules/keys'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProductCostSummary } from '@/lib/assistant/costing'

async function requireProductsAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.PRODUCTS_BOM, {
    forbiddenMessage: 'Products module access is disabled for your organization',
  })
  if ('error' in access) return { error: access.error }
  if (!access.orgId) {
    return {
      error: NextResponse.json(
        { error: 'Organization context is required', reason: 'missing_org_context' },
        { status: 403 }
      ),
    }
  }
  return { orgId: access.orgId }
}

type Period = '7d' | '30d' | '90d' | '365d' | 'all'

function getPeriodStart(period: Period): string | null {
  if (period === 'all') return null
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

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
    const periodRaw = url.searchParams.get('period') ?? 'all'
    const period: Period = ['7d', '30d', '90d', '365d', 'all'].includes(periodRaw)
      ? (periodRaw as Period)
      : 'all'
    const periodStart = getPeriodStart(period)

    // Verify product belongs to this org
    const { data: product, error: productErr } = await supabaseAdmin
      .from('products')
      .select('product_id, internal_code')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle()
    if (productErr || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Build order_details query
    // orders table uses status_id (FK to order_statuses), not a status column
    const { data: rawOrders, error: ordersErr } = await supabaseAdmin
      .from('order_details')
      .select(`
        order_detail_id,
        order_id,
        quantity,
        unit_price,
        order:orders(order_id, order_number, order_date, org_id, status:order_statuses(status_name), customer:customers(name))
      `)
      .eq('product_id', productId)

    if (ordersErr) {
      console.error('product-reports orders query error:', ordersErr)
      throw ordersErr
    }

    // Filter client-side: org, status, period
    const filteredOrders = (rawOrders ?? []).filter((row: any) => {
      const order = row.order
      if (!order) return false
      if (order.org_id !== auth.orgId) return false
      const statusName = order.status?.status_name?.toLowerCase()
      if (statusName === 'cancelled') return false
      if (periodStart) {
        if (!order.order_date) return false
        if (order.order_date < periodStart) return false
      }
      return true
    })

    filteredOrders.sort((a: any, b: any) => {
      const dateA = a.order?.order_date ?? ''
      const dateB = b.order?.order_date ?? ''
      return dateB.localeCompare(dateA)
    })

    // Get BOM cost via getProductCostSummary (passes auth through to internal API routes)
    let bomCost = { materials: 0, labor: 0, overhead: 0, total: 0, missingPrices: 0 }
    let bomCostAvailable = false
    try {
      const origin = `${url.protocol}//${url.host}`
      const authorizationHeader = req.headers.get('authorization')
      const productRef = String(productId)
      const costSummary = await getProductCostSummary(supabaseAdmin, productRef, {
        origin,
        authorizationHeader,
      })

      if (costSummary.kind === 'summary') {
        bomCost = {
          materials: costSummary.materials_cost,
          labor: costSummary.labor_cost,
          overhead: costSummary.overhead_cost,
          total: costSummary.total_cost,
          missingPrices: costSummary.missing_material_prices,
        }
        bomCostAvailable = true
      } else {
        console.warn('product-reports: BOM cost unavailable:', costSummary.kind)
      }
    } catch (bomErr) {
      console.warn('product-reports: BOM cost fetch failed, continuing with zero cost:', bomErr)
    }

    const orders = filteredOrders.map((row: any) => ({
      orderDetailId: row.order_detail_id,
      orderId: row.order_id,
      orderNumber: row.order?.order_number ?? null,
      customerName: row.order?.customer?.name ?? null,
      date: row.order?.order_date ?? null,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
    }))

    return NextResponse.json({ bomCost, bomCostAvailable, orders })
  } catch (err) {
    console.error('product-reports error:', err)
    return NextResponse.json({ error: 'Failed to load product reports' }, { status: 500 })
  }
}
