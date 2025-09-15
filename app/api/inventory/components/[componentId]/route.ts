import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function DELETE(
  _req: Request,
  { params }: { params: { componentId: string } }
) {
  const idNum = Number(params.componentId)
  if (!idNum || Number.isNaN(idNum)) {
    return new NextResponse('Invalid component id', { status: 400 })
  }

  try {
    // 1) Delete inventory transactions
    {
      const { error } = await supabaseAdmin
        .from('inventory_transactions')
        .delete()
        .eq('component_id', idNum)
      if (error) throw error
    }

    // 2) Delete inventory rows
    {
      const { error } = await supabaseAdmin
        .from('inventory')
        .delete()
        .eq('component_id', idNum)
      if (error) throw error
    }

    // 3) Delete supplier components
    {
      const { error } = await supabaseAdmin
        .from('suppliercomponents')
        .delete()
        .eq('component_id', idNum)
      if (error) throw error
    }

    // 4) Delete the component itself
    {
      const { error } = await supabaseAdmin
        .from('components')
        .delete()
        .eq('component_id', idNum)
      if (error) throw error
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('DELETE /api/inventory/components error:', e)
    const message = e?.message || 'Failed to delete component'
    return new NextResponse(message, { status: 500 })
  }
}

