import { NextRequest, NextResponse } from 'next/server'

import { requireModuleAccess } from '@/lib/api/module-access'
import { MODULE_KEYS } from '@/lib/modules/keys'
import { loadChildLabourBasis } from '@/lib/products/bol-costing'
import {
  computeEffectiveOverheadLines,
  type DirectOverheadRow,
} from '@/lib/products/effective-overhead'
import { supabaseAdmin } from '@/lib/supabase-admin'

type RouteParams = {
  productId?: string
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

    if (productError) {
      return NextResponse.json({ error: productError.message }, { status: 500 })
    }
    if (!product) {
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
      loadChildLabourBasis(supabaseAdmin, childIds, auth.orgId),
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
