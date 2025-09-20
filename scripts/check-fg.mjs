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

async function rpcExists(name) {
  // Try calling with a benign parameter; if function is missing, PostgREST returns 404/400
  const { data, error, status } = await supabase.rpc(name, { p_order_id: -1 })
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

  console.log('\n=== FG RPC Check ===')
  const rpcs = ['reserve_finished_goods', 'release_finished_goods', 'consume_finished_goods']
  for (const f of rpcs) {
    const ok = await rpcExists(f)
    console.log(`Function ${f}: ${ok ? 'OK (callable)' : 'MISSING'}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
