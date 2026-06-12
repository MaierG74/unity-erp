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

interface WhereUsedParent {
  product_id: number
  internal_code: string | null
  name: string | null
  scale: number
}

// Parents that use this product as a subcomponent
export async function GET(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

  try {
    const { productId } = await context.params
    const subProductId = Number(productId)
    if (!Number.isFinite(subProductId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 })
    }

    const { data: links, error: linkErr } = await supabaseAdmin
      .from('product_bom_links')
      .select('product_id, scale')
      .eq('sub_product_id', subProductId)
      .eq('org_id', auth.orgId)
    if (linkErr) throw linkErr

    const parentIds = (links || []).map((l) => Number(l.product_id))

    // Two-step lookup — product_bom_links has two FKs to products, so an
    // un-hinted embed would be ambiguous (PGRST201).
    const productById = new Map<number, { internal_code: string; name: string }>()
    if (parentIds.length > 0) {
      const { data: prods, error: prodErr } = await supabaseAdmin
        .from('products')
        .select('product_id, internal_code, name')
        .in('product_id', parentIds)
        .eq('org_id', auth.orgId)
      if (prodErr) throw prodErr
      for (const p of prods || []) {
        productById.set(Number(p.product_id), { internal_code: p.internal_code, name: p.name })
      }
    }

    const parents: WhereUsedParent[] = (links || [])
      .map((l) => {
        const product = productById.get(Number(l.product_id))
        return {
          product_id: Number(l.product_id),
          internal_code: product?.internal_code ?? null,
          name: product?.name ?? null,
          scale: Number(l.scale ?? 1),
        }
      })
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

    return NextResponse.json({ count: parents.length, parents })
  } catch (err) {
    console.error('where-used error:', err)
    return NextResponse.json({ error: 'Failed to load where-used' }, { status: 500 })
  }
}
