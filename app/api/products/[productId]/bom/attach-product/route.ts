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

// Create an Attach link (phantom, single-level)
export async function POST(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

  try {
    const { productId } = await context.params
    const parentProductId = Number(productId)
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

    // Ensure both products exist
    const { data: parent, error: parentErr } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', parentProductId)
      .eq('org_id', auth.orgId)
      .maybeSingle()
    if (parentErr || !parent) return NextResponse.json({ error: 'Parent not found' }, { status: 404 })

    const { data: sub, error: subErr } = await supabaseAdmin
      .from('products')
      .select('product_id')
      .eq('product_id', subProductId)
      .eq('org_id', auth.orgId)
      .maybeSingle()
    if (subErr || !sub) return NextResponse.json({ error: 'Sub product not found' }, { status: 404 })

    // Upsert link
    const { error: insErr } = await supabaseAdmin
      .from('product_bom_links')
      .upsert(
        {
          product_id: parentProductId,
          sub_product_id: subProductId,
          scale: scaleNum,
          mode: 'phantom',
          org_id: auth.orgId,
        },
        { onConflict: 'product_id,sub_product_id' }
      )
    if (insErr) throw insErr

    return NextResponse.json({ attached: true })
  } catch (err) {
    console.error('attach-product error:', err)
    return NextResponse.json({ error: 'Failed to attach product' }, { status: 500 })
  }
}

// Detach link
export async function DELETE(req: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await requireProductsAccess(req)
  if ('error' in auth) return auth.error

  try {
    const url = new URL(req.url)
    const subIdParam = url.searchParams.get('sub_product_id')
    const { productId } = await context.params
    const parentProductId = Number(productId)
    const subProductId = Number(subIdParam)
    if (!Number.isFinite(parentProductId) || !Number.isFinite(subProductId)) {
      return NextResponse.json({ error: 'Invalid productId or sub_product_id' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('product_bom_links')
      .delete()
      .eq('product_id', parentProductId)
      .eq('sub_product_id', subProductId)
      .eq('org_id', auth.orgId)
    if (error) throw error
    return NextResponse.json({ detached: true })
  } catch (err) {
    console.error('detach-product error:', err)
    return NextResponse.json({ error: 'Failed to detach product' }, { status: 500 })
  }
}
