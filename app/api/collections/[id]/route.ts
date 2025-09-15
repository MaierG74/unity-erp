import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = admin()
    const id = Number(params.id)
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const { data: collection, error: errCol } = await supabase
      .from('bom_collections')
      .select('collection_id, code, name, description, is_phantom, version, status, created_at, updated_at')
      .eq('collection_id', id)
      .single()
    if (errCol) throw errCol

    const { data: items, error: errItems } = await supabase
      .from('bom_collection_items')
      .select('item_id, component_id, quantity_required, supplier_component_id, components(component_id, internal_code, description)')
      .eq('collection_id', id)
      .order('item_id')
    if (errItems) throw errItems

    return NextResponse.json({ collection, items: items ?? [] })
  } catch (err: any) {
    console.error('Collections get error:', err)
    return NextResponse.json({ error: 'Failed to fetch collection' }, { status: 500 })
  }
}
