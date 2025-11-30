import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const collectionId = parseInt(id, 10)
    if (isNaN(collectionId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
    }

    const supabase = admin()

    // 1. Get current status
    const { data: current, error: getErr } = await supabase
      .from('bom_collections')
      .select('status, version')
      .eq('collection_id', collectionId)
      .single()

    if (getErr) throw getErr
    if (!current) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    if (current.status !== 'draft') {
      return NextResponse.json({ error: 'Only draft collections can be published' }, { status: 400 })
    }

    // 2. Update status to published and bump version
    // Note: In a real scenario, we might want to archive the previous version if we were keeping history rows,
    // but per docs, we just bump the version number on the main row for now to signify a release.
    // "Publishing bumps version... Future edits happen in a new draft" -> this implies we might need a new row for the new draft?
    // The docs say: "Publish freezes a snapshot... Future edits happen in a new draft".
    // However, the current schema doesn't seem to support multiple rows for the same "code" easily if 'code' is unique.
    // Let's re-read the schema in the docs.
    // "code text unique not null" -> This means we can't have multiple rows with the same code.
    // "version integer not null default 1"
    // "status text not null default 'draft'"
    //
    // If code is unique, we can't have a "draft" row and a "published" row for the same code in the same table.
    // The docs say: "Temporary manual publish... update public.bom_collections set version = version + 1, status = 'published' where collection_id = :id;"
    // This implies we just update the single row.
    // And then "Future edits happen in a new draft" -> this part is tricky if we only have one row.
    // If we update it to 'published', how do we edit it again?
    // Maybe the intention is that when you start editing a 'published' collection, it flips back to 'draft'?
    // Or maybe the docs imply a more complex model that isn't fully implemented yet.
    // "Create/maintain master components... Using a draft... Publish workflow... When we add the Publish action it will bump version and set status='published'"
    //
    // Let's stick to the manual workaround described: Update status to 'published' and increment version.
    // When the user edits again, we probably need to flip it back to 'draft' or handle it in the update logic.
    // For now, the "Publish" action just does the state transition.

    const { data: updated, error: updErr } = await supabase
      .from('bom_collections')
      .update({
        status: 'published',
        version: current.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('collection_id', collectionId)
      .select()
      .single()

    if (updErr) throw updErr

    return NextResponse.json({ collection: updated })
  } catch (err: any) {
    console.error('Publish error:', err)
    return NextResponse.json({ error: 'Failed to publish collection' }, { status: 500 })
  }
}
