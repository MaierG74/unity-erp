import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !service) {
  console.error('[check-fg] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const supabase = createClient(url, service, { auth: { persistSession: false } })

async function tableExists(name) {
  const { error } = await supabase.from(name).select('count', { count: 'exact', head: true })
  return !error
}

const rpcSmokeParams = {
  reserve_finished_goods: { p_order_id: -1 },
  release_finished_goods: { p_order_id: -1 },
  consume_finished_goods: { p_order_id: -1 },
  auto_consume_on_add: { p_product_id: -1, p_quantity: 0 }
}

async function rpcExists(name) {
  // Try calling with a benign parameter; if function is missing, PostgREST returns 404/400
  const payload = rpcSmokeParams[name] ?? {}
  const { error, status } = await supabase.rpc(name, payload)
  if (error) {
    const msg = (error.message || '').toLowerCase()
    if (msg.includes('function') && msg.includes('not') && msg.includes('found')) return false
    // Other errors (e.g., invalid input) still indicate the function endpoint exists
    return true
  }
  // If it succeeded (unlikely with -1), it exists
  return status >= 200 && status < 500
}

async function main() {
  console.log('=== FG Schema Check ===')
  const tables = ['products', 'product_inventory', 'product_reservations', 'product_inventory_transactions']
  for (const t of tables) {
    const ok = await tableExists(t)
    console.log(`Table ${t}: ${ok ? 'OK' : 'MISSING'}`)
  }

  console.log('\n=== Materialized Views ===')
  const views = ['component_status_mv']
  for (const v of views) {
    const ok = await tableExists(v)
    console.log(`View ${v}: ${ok ? 'OK' : 'MISSING'}`)
  }

  console.log('\n=== FG RPC Check ===')
  const rpcs = ['reserve_finished_goods', 'release_finished_goods', 'consume_finished_goods', 'auto_consume_on_add']
  for (const f of rpcs) {
    const ok = await rpcExists(f)
    console.log(`Function ${f}: ${ok ? 'OK (callable)' : 'MISSING'}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
