import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string

if (!url || !serviceKey) {
  console.error('[cleanup-smoke] Missing env NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

async function run() {
  console.log('[cleanup-smoke] Starting cleanup of SMOKE_* test data')

  // 1) Identify components and suppliercomponents tagged by SMOKE_*
  const { data: components, error: compErr } = await supabase
    .from('components')
    .select('component_id, internal_code')
    .like('internal_code', 'SMOKE_%')
  if (compErr) throw compErr
  const componentIds = (components || []).map((c) => c.component_id as number)

  const { data: suppComps, error: scErr } = await supabase
    .from('suppliercomponents')
    .select('supplier_component_id, component_id, supplier_id, supplier_code')
    .like('supplier_code', 'SMOKE_%')
  if (scErr) throw scErr
  const supplierComponentIds = (suppComps || []).map((s) => s.supplier_component_id as number)

  // 2) Find supplier orders for those suppliercomponents
  let orderIds: number[] = []
  if (supplierComponentIds.length) {
    const { data: orders, error: soErr } = await supabase
      .from('supplier_orders')
      .select('order_id')
      .in('supplier_component_id', supplierComponentIds)
    if (soErr) throw soErr
    orderIds = (orders || []).map((o) => o.order_id as number)
  }

  // 3) Collect receipts + transaction IDs before deletion
  let transactionIds: number[] = []
  if (orderIds.length) {
    const { data: receipts, error: recErr } = await supabase
      .from('supplier_order_receipts')
      .select('receipt_id, transaction_id')
      .in('order_id', orderIds)
    if (recErr) throw recErr
    transactionIds = (receipts || []).map((r) => r.transaction_id as number)
    // 3a) Delete receipts
    const { error: delRecErr } = await supabase
      .from('supplier_order_receipts')
      .delete()
      .in('order_id', orderIds)
    if (delRecErr) throw delRecErr
    console.log(`[cleanup-smoke] Deleted ${receipts?.length || 0} receipts`)
  }

  // 4) Delete inventory transactions created by those receipts
  if (transactionIds.length) {
    const { error: delTxErr } = await supabase
      .from('inventory_transactions')
      .delete()
      .in('transaction_id', transactionIds)
    if (delTxErr) throw delTxErr
    console.log(`[cleanup-smoke] Deleted ${transactionIds.length} inventory transactions`)
  }

  // 5) Delete inventory rows for SMOKE components
  if (componentIds.length) {
    const { error: delInvErr } = await supabase
      .from('inventory')
      .delete()
      .in('component_id', componentIds)
    if (delInvErr) throw delInvErr
    console.log(`[cleanup-smoke] Deleted inventory rows for ${componentIds.length} components`)
  }

  // 6) Delete supplier orders
  if (orderIds.length) {
    const { error: delSoErr } = await supabase
      .from('supplier_orders')
      .delete()
      .in('order_id', orderIds)
    if (delSoErr) throw delSoErr
    console.log(`[cleanup-smoke] Deleted ${orderIds.length} supplier orders`)
  }

  // 7) Delete purchase orders created by smoke (by notes)
  const { data: poRows, error: poSelErr } = await supabase
    .from('purchase_orders')
    .select('purchase_order_id')
    .like('notes', 'SMOKE_% PO')
  if (poSelErr) throw poSelErr
  if (poRows && poRows.length) {
    const poIds = poRows.map((r) => r.purchase_order_id as number)
    const { error: delPoErr } = await supabase
      .from('purchase_orders')
      .delete()
      .in('purchase_order_id', poIds)
    if (delPoErr) throw delPoErr
    console.log(`[cleanup-smoke] Deleted ${poIds.length} purchase orders`)
  }

  // 8) Delete suppliercomponents
  if (supplierComponentIds.length) {
    const { error: delScErr } = await supabase
      .from('suppliercomponents')
      .delete()
      .in('supplier_component_id', supplierComponentIds)
    if (delScErr) throw delScErr
    console.log(`[cleanup-smoke] Deleted ${supplierComponentIds.length} suppliercomponents`)
  }

  // 9) Delete components
  if (componentIds.length) {
    const { error: delCompErr } = await supabase
      .from('components')
      .delete()
      .in('component_id', componentIds)
    if (delCompErr) throw delCompErr
    console.log(`[cleanup-smoke] Deleted ${componentIds.length} components`)
  }

  // 10) Delete suppliers tagged by name
  const { data: supplierRows, error: supSelErr } = await supabase
    .from('suppliers')
    .select('supplier_id')
    .like('name', 'SMOKE_% SUPPLIER')
  if (supSelErr) throw supSelErr
  if (supplierRows && supplierRows.length) {
    const supplierIds = supplierRows.map((s) => s.supplier_id as number)
    const { error: delSupErr } = await supabase
      .from('suppliers')
      .delete()
      .in('supplier_id', supplierIds)
    if (delSupErr) throw delSupErr
    console.log(`[cleanup-smoke] Deleted ${supplierIds.length} suppliers`)
  }

  console.log('[cleanup-smoke] Cleanup complete')
}

run().catch((err) => {
  console.error('[cleanup-smoke] FAILED', err)
  process.exit(1)
})

