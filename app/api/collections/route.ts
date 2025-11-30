import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { BomCollectionItemInput } from '@/types/collections'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  try {
    const supabase = admin()
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10) || 25, 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10) || 0

    let query = supabase
      .from('bom_collections')
      .select('collection_id, code, name, description, is_phantom, version, status, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (q) {
      query = query.ilike('name', `%${q}%`)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ collections: data ?? [] })
  } catch (err: any) {
    console.error('Collections list error:', err)
    return NextResponse.json({ error: 'Failed to list collections' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      collection_id,
      code,
      name,
      description,
      is_phantom = true,
      items = [],
    }: {
      collection_id?: number
      code: string
      name: string
      description?: string | null
      is_phantom?: boolean
      items?: BomCollectionItemInput[]
    } = body

    if (!code || !name) {
      return NextResponse.json({ error: 'code and name are required' }, { status: 400 })
    }

    const supabase = admin()

    let id = collection_id as number | undefined
    if (id) {
      const { error: updErr } = await supabase
        .from('bom_collections')
        .update({ code, name, description, is_phantom })
        .eq('collection_id', id)
      if (updErr) throw updErr
    } else {
      const { data, error: insErr } = await supabase
        .from('bom_collections')
        .insert({ code, name, description, is_phantom })
        .select('collection_id')
        .single()
      if (insErr) throw insErr
      id = data!.collection_id
    }

    // Replace items if provided
    if (Array.isArray(items)) {
      // delete existing
      const { error: delErr } = await supabase
        .from('bom_collection_items')
        .delete()
        .eq('collection_id', id!)
      if (delErr) throw delErr

      if (items.length > 0) {
        const rows = items.map((it) => ({
          collection_id: id!,
          component_id: it.component_id,
          quantity_required: it.quantity_required,
          supplier_component_id: it.supplier_component_id ?? null,
        }))
        const { error: insItemsErr } = await supabase
          .from('bom_collection_items')
          .insert(rows)
        if (insItemsErr) throw insItemsErr
      }
    }

    // Return full collection with items
    const { data: collection, error: getErr } = await supabase
      .from('bom_collections')
      .select('collection_id, code, name, description, is_phantom, version, status, created_at, updated_at')
      .eq('collection_id', id!)
      .single()
    if (getErr) throw getErr

    const { data: itemsOut, error: itemsErr } = await supabase
      .from('bom_collection_items')
      .select('item_id, component_id, quantity_required, supplier_component_id')
      .eq('collection_id', id!)
      .order('item_id')
    if (itemsErr) throw itemsErr

    return NextResponse.json({ collection, items: itemsOut ?? [] })
  } catch (err: any) {
    console.error('Collections create/update error:', err)
    return NextResponse.json({ error: 'Failed to save collection' }, { status: 500 })
  }
}

