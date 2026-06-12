import { NextRequest, NextResponse } from 'next/server'

import { getActiveCategoryRate } from '@/lib/api/job-category-rate'
import { requireModuleAccess } from '@/lib/api/module-access'
import { MODULE_KEYS } from '@/lib/modules/keys'
import {
  computeEffectiveOverheadLines,
  type DirectOverheadRow,
} from '@/lib/products/effective-overhead'
import { supabaseAdmin } from '@/lib/supabase-admin'

type RouteParams = {
  productId?: string
}

type BolRow = {
  product_id: number
  job_id: number
  time_required: number | null
  time_unit: 'hours' | 'minutes' | 'seconds' | null
  quantity: number | null
  pay_type: 'hourly' | 'piece' | null
  rate_id: number | null
  piece_rate_id: number | null
  hourly_rate_id: number | null
}

function parseId(value?: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toHours(value: number, unit: 'hours' | 'minutes' | 'seconds' | null): number {
  if (unit === 'minutes') return value / 60
  if (unit === 'seconds') return value / 3600
  return value
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
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

function mapOverheadRow(row: any): DirectOverheadRow | null {
  const element = relationOne(row.overhead_cost_elements as any)
  if (!element) return null

  return {
    id: row.id == null ? null : Number(row.id),
    element_id: Number(row.element_id),
    code: String(element.code ?? ''),
    name: String(element.name ?? ''),
    cost_type: element.cost_type === 'percentage' ? 'percentage' : 'fixed',
    percentage_basis:
      element.percentage_basis === 'materials' || element.percentage_basis === 'labor' || element.percentage_basis === 'total'
        ? element.percentage_basis
        : null,
    quantity: numeric(row.quantity, 1),
    default_value: numeric(element.default_value),
    override_value: row.override_value == null ? null : numeric(row.override_value),
  }
}

async function loadOverheadByProduct(productIds: number[]): Promise<Map<number, DirectOverheadRow[]>> {
  const uniqueIds = Array.from(new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)))
  const byProduct = new Map<number, DirectOverheadRow[]>()
  for (const id of uniqueIds) byProduct.set(id, [])
  if (uniqueIds.length === 0) return byProduct

  const { data, error } = await supabaseAdmin
    .from('product_overhead_costs')
    .select(`
      id,
      product_id,
      element_id,
      quantity,
      override_value,
      created_at,
      overhead_cost_elements (
        element_id,
        code,
        name,
        cost_type,
        default_value,
        percentage_basis
      )
    `)
    .in('product_id', uniqueIds)
    .order('created_at', { ascending: true })

  if (error) throw error

  for (const row of data ?? []) {
    const productId = Number(row.product_id)
    const mapped = mapOverheadRow(row)
    if (!mapped) continue
    byProduct.set(productId, [...(byProduct.get(productId) ?? []), mapped])
  }

  return byProduct
}

async function loadChildMaterialBasis(childIds: number[]): Promise<Map<number, number>> {
  const byProduct = new Map<number, number>()
  for (const id of childIds) byProduct.set(id, 0)
  if (childIds.length === 0) return byProduct

  const { data, error } = await supabaseAdmin
    .from('billofmaterials')
    .select('product_id, quantity_required, suppliercomponents(price)')
    .in('product_id', childIds)

  if (error) throw error

  for (const row of data ?? []) {
    const productId = Number(row.product_id)
    const supplier = relationOne(row.suppliercomponents as any)
    const lineCost = numeric(row.quantity_required) * numeric(supplier?.price)
    byProduct.set(productId, (byProduct.get(productId) ?? 0) + lineCost)
  }

  return byProduct
}

async function resolvePieceRate(row: BolRow, today: string): Promise<number | null> {
  if (row.piece_rate_id) {
    const { data, error } = await supabaseAdmin
      .from('piece_work_rates')
      .select('rate')
      .eq('rate_id', row.piece_rate_id)
      .maybeSingle()
    if (error) throw error
    if (data) return numeric((data as any).rate)
  }

  const { data, error } = await supabaseAdmin
    .from('piece_work_rates')
    .select('rate, product_id, effective_date, end_date')
    .eq('job_id', row.job_id)
    .lte('effective_date', today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('effective_date', { ascending: false })
  if (error) throw error

  const chosen = ((data ?? []) as any[]).find((candidate) => Number(candidate.product_id) === row.product_id)
    ?? ((data ?? []) as any[]).find((candidate) => candidate.product_id == null)
    ?? null
  return chosen ? numeric(chosen.rate) : null
}

async function resolveHourlyRate(row: BolRow, today: string): Promise<number | null> {
  if (row.hourly_rate_id) {
    const { data, error } = await supabaseAdmin
      .from('job_hourly_rates')
      .select('hourly_rate')
      .eq('rate_id', row.hourly_rate_id)
      .maybeSingle()
    if (error) throw error
    if (data) return numeric((data as any).hourly_rate)
  }

  if (row.rate_id) {
    const { data, error } = await supabaseAdmin
      .from('job_category_rates')
      .select('hourly_rate')
      .eq('rate_id', row.rate_id)
      .maybeSingle()
    if (error) throw error
    if (data) return numeric((data as any).hourly_rate)
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from('jobs')
    .select('category_id')
    .eq('job_id', row.job_id)
    .maybeSingle()
  if (jobError) throw jobError

  const categoryId = Number((job as any)?.category_id)
  if (!Number.isFinite(categoryId) || categoryId <= 0) return null
  const categoryRate = await getActiveCategoryRate(categoryId, today)
  return categoryRate?.hourly_rate ?? null
}

async function loadChildLabourBasis(childIds: number[], orgId: string): Promise<Map<number, number>> {
  const byProduct = new Map<number, number>()
  for (const id of childIds) byProduct.set(id, 0)
  if (childIds.length === 0) return byProduct

  const { data, error } = await supabaseAdmin
    .from('billoflabour')
    .select('product_id, job_id, time_required, time_unit, quantity, pay_type, rate_id, piece_rate_id, hourly_rate_id')
    .in('product_id', childIds)
    .eq('org_id', orgId)
  if (error) throw error

  const today = new Date().toISOString().split('T')[0]
  for (const raw of (data ?? []) as any[]) {
    const row = {
      product_id: Number(raw.product_id),
      job_id: Number(raw.job_id),
      time_required: raw.time_required == null ? null : numeric(raw.time_required),
      time_unit: raw.time_unit ?? 'hours',
      quantity: raw.quantity == null ? 1 : numeric(raw.quantity, 1),
      pay_type: raw.pay_type === 'piece' ? 'piece' : 'hourly',
      rate_id: raw.rate_id == null ? null : Number(raw.rate_id),
      piece_rate_id: raw.piece_rate_id == null ? null : Number(raw.piece_rate_id),
      hourly_rate_id: raw.hourly_rate_id == null ? null : Number(raw.hourly_rate_id),
    } satisfies BolRow

    const quantity = numeric(row.quantity, 1)
    const lineCost = row.pay_type === 'piece'
      ? quantity * numeric(await resolvePieceRate(row, today))
      : quantity * toHours(numeric(row.time_required), row.time_unit) * numeric(await resolveHourlyRate(row, today))
    byProduct.set(row.product_id, (byProduct.get(row.product_id) ?? 0) + lineCost)
  }

  return byProduct
}

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireProductsAccess(request)
  if ('error' in auth) return auth.error

  const params = await context.params
  const productId = parseId(params.productId)
  if (!productId) {
    return NextResponse.json({ error: 'Invalid product id' }, { status: 400 })
  }

  try {
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .maybeSingle()

    if (productError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const { data: linksData, error: linkError } = await supabaseAdmin
      .from('product_bom_links')
      .select('sub_product_id, scale, mode')
      .eq('product_id', productId)
      .eq('org_id', auth.orgId)
      .eq('mode', 'phantom')
    if (linkError) throw linkError

    const linkRows = (linksData ?? []) as Array<{
      sub_product_id: number | string | null
      scale: number | string | null
      mode: string | null
    }>
    const childIds: number[] = Array.from(new Set(linkRows
      .map((link) => Number(link.sub_product_id))
      .filter((id): id is number => Number.isFinite(id) && id > 0)))

    const { data: childProducts, error: childProductError } = childIds.length > 0
      ? await supabaseAdmin
        .from('products')
        .select('product_id, name')
        .eq('org_id', auth.orgId)
        .in('product_id', childIds)
      : { data: [], error: null }
    if (childProductError) throw childProductError

    const childNameById = new Map(((childProducts ?? []) as Array<{ product_id: number | string; name: string | null }>).map((row) => [
      Number(row.product_id),
      String(row.name ?? `Product ${row.product_id}`),
    ]))
    const links = linkRows.map((link) => ({
      sub_product_id: Number(link.sub_product_id),
      sub_product_name: childNameById.get(Number(link.sub_product_id)) ?? `Product ${link.sub_product_id}`,
      scale: numeric(link.scale, 1),
      mode: String(link.mode ?? 'phantom'),
    }))

    const [overheadByProduct, materialBasis, labourBasis] = await Promise.all([
      loadOverheadByProduct([productId, ...childIds]),
      loadChildMaterialBasis(childIds),
      loadChildLabourBasis(childIds, auth.orgId),
    ])

    const childBasisBySubId = new Map(childIds.map((childId) => [
      childId,
      {
        materialsCost: materialBasis.get(childId) ?? 0,
        labourCost: labourBasis.get(childId) ?? 0,
      },
    ]))

    const childOverheadBySubId = new Map(childIds.map((childId) => [childId, overheadByProduct.get(childId) ?? []]))
    const items = computeEffectiveOverheadLines({
      direct: overheadByProduct.get(productId) ?? [],
      links,
      childOverheadBySubId,
      childBasisBySubId,
    })

    return NextResponse.json({
      items,
      meta: {
        links_count: links.length,
        child_basis_note: 'child percentage basis = child direct BOM + BOL; excludes cutlist padding',
      },
    })
  } catch (error) {
    console.error('[effective-overhead] unexpected error', error)
    return NextResponse.json({ error: 'Failed to compute effective overhead' }, { status: 500 })
  }
}
