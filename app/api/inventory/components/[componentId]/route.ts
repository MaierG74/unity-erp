import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

async function countRows(table: string, componentId: number) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('component_id', componentId)

  if (error) {
    throw new Error(`Failed to check ${table}: ${error.message}`)
  }

  return count ?? 0
}

async function assertComponentCanBeDeleted(componentId: number) {
  const checks = await Promise.all([
    countRows('inventory_transactions', componentId),
    countRows('stock_issuances', componentId),
    countRows('billofmaterials', componentId),
    countRows('bom_collection_items', componentId),
    countRows('section_details', componentId),
    countRows('quote_cluster_lines', componentId),
    countRows('supplier_order_customer_orders', componentId),
  ])

  const totalUsage = checks.reduce((sum, value) => sum + value, 0)
  if (totalUsage > 0) {
    return new NextResponse(
      'Cannot delete component because it has stock history or related usage. Disable it instead to preserve audit history.',
      { status: 409 }
    )
  }

  return null
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ componentId: string }> }
) {
  const { componentId } = await context.params
  const idNum = Number(componentId)
  if (!idNum || Number.isNaN(idNum)) {
    return new NextResponse('Invalid component id', { status: 400 })
  }

  try {
    const blockedResponse = await assertComponentCanBeDeleted(idNum)
    if (blockedResponse) return blockedResponse

    // Delete all related records in order of dependencies
    
    // 1) Delete stock issuances
    {
      const { error } = await supabaseAdmin
        .from('stock_issuances')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('stock_issuances delete:', error.message)
    }

    // 2) Delete inventory transactions
    {
      const { error } = await supabaseAdmin
        .from('inventory_transactions')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('inventory_transactions delete:', error.message)
    }

    // 3) Delete inventory rows
    {
      const { error } = await supabaseAdmin
        .from('inventory')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('inventory delete:', error.message)
    }

    // 4) Delete supplier components
    {
      const { error } = await supabaseAdmin
        .from('suppliercomponents')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('suppliercomponents delete:', error.message)
    }

    // 5) Delete component follow-up emails (has CASCADE but be explicit)
    {
      const { error } = await supabaseAdmin
        .from('component_follow_up_emails')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('component_follow_up_emails delete:', error.message)
    }

    // 6) Delete quote cluster lines
    {
      const { error } = await supabaseAdmin
        .from('quote_cluster_lines')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('quote_cluster_lines delete:', error.message)
    }

    // 7) Delete bom collection items
    {
      const { error } = await supabaseAdmin
        .from('bom_collection_items')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('bom_collection_items delete:', error.message)
    }

    // 8) Delete section details
    {
      const { error } = await supabaseAdmin
        .from('section_details')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('section_details delete:', error.message)
    }

    // 9) Delete supplier order customer orders
    {
      const { error } = await supabaseAdmin
        .from('supplier_order_customer_orders')
        .delete()
        .eq('component_id', idNum)
      if (error) console.warn('supplier_order_customer_orders delete:', error.message)
    }

    // 10) Delete the component itself
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
