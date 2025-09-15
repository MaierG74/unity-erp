import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Usage:
//  tsx scripts/cleanup-purchasing.ts --dry-run
//  tsx scripts/cleanup-purchasing.ts --after=2025-01-01
//  tsx scripts/cleanup-purchasing.ts --poIds=1,2,3

dotenv.config({ path: './.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

type Args = {
  dryRun: boolean;
  after?: string;
  poIds?: number[];
  clampZero: boolean;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { dryRun: false, clampZero: true } as Args;
  for (const a of args) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a.startsWith('--after=')) out.after = a.split('=')[1];
    else if (a.startsWith('--poIds=')) out.poIds = a.split('=')[1].split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
    else if (a === '--allow-negative') out.clampZero = false;
  }
  return out;
}

async function main() {
  const { dryRun, after, poIds, clampZero } = parseArgs();
  console.log(`Cleanup Purchasing starting. dryRun=${dryRun} after=${after ?? 'n/a'} poIds=${poIds?.join(',') ?? 'all'} clampZero=${clampZero}`);

  // 1) Load target POs
  let poQuery = supabase.from('purchase_orders').select('purchase_order_id, created_at').order('created_at', { ascending: false });
  if (after) poQuery = poQuery.gte('created_at', new Date(after).toISOString());
  if (poIds && poIds.length) poQuery = poQuery.in('purchase_order_id', poIds);
  const { data: pos, error: poErr } = await poQuery;
  if (poErr) throw poErr;

  const targetPoIds = (pos ?? []).map((p) => p.purchase_order_id);
  if (!targetPoIds.length) {
    console.log('No purchase orders matched the criteria. Nothing to do.');
    return;
  }
  console.log(`Target POs: ${targetPoIds.length}`);

  // 2) Load supplier orders for target POs
  const { data: sos, error: soErr } = await supabase
    .from('supplier_orders')
    .select('order_id, supplier_component_id, purchase_order_id')
    .in('purchase_order_id', targetPoIds);
  if (soErr) throw soErr;

  const soIds = (sos ?? []).map((s) => s.order_id);
  console.log(`Supplier orders: ${soIds.length}`);

  // Early out on dry-run with zero SOs
  if (!soIds.length) {
    if (dryRun) {
      console.log('No supplier orders under target POs. Cleanup would only delete POs.');
    }
  }

  // 3) Load receipts
  const { data: receipts, error: rErr } = await supabase
    .from('supplier_order_receipts')
    .select('receipt_id, order_id, quantity_received, transaction_id')
    .in('order_id', soIds);
  if (rErr) throw rErr;
  const txIds = Array.from(new Set((receipts ?? []).map((r) => r.transaction_id))).filter(Boolean) as number[];
  console.log(`Receipts: ${receipts?.length ?? 0}, Transactions to delete: ${txIds.length}`);

  // 4) Map SO -> supplier_component -> component
  const supplierComponentIds = Array.from(new Set((sos ?? []).map((s) => s.supplier_component_id))).filter(Boolean) as number[];
  const scBatches: number[][] = [];
  const batchSize = 1000;
  for (let i = 0; i < supplierComponentIds.length; i += batchSize) scBatches.push(supplierComponentIds.slice(i, i + batchSize));
  const scMap = new Map<number, number>(); // supplier_component_id -> component_id
  for (const batch of scBatches) {
    if (!batch.length) continue;
    const { data: scs, error: scErr } = await supabase
      .from('suppliercomponents')
      .select('supplier_component_id, component_id')
      .in('supplier_component_id', batch);
    if (scErr) throw scErr;
    (scs ?? []).forEach((sc) => scMap.set(sc.supplier_component_id, sc.component_id));
  }

  // 5) Compute deltas per component from receipts
  const soById = new Map((sos ?? []).map((s) => [s.order_id, s] as const));
  const deltas = new Map<number, number>(); // component_id -> qty to subtract
  for (const r of receipts ?? []) {
    const so = soById.get(r.order_id);
    if (!so) continue;
    const componentId = scMap.get(so.supplier_component_id);
    if (!componentId) continue;
    deltas.set(componentId, (deltas.get(componentId) ?? 0) + (r.quantity_received ?? 0));
  }
  console.log(`Components with inventory to reverse: ${deltas.size}`);

  // 6) Dry run reporting
  if (dryRun) {
    console.log('--- DRY RUN SUMMARY ---');
    console.log({
      purchaseOrders: targetPoIds.length,
      supplierOrders: soIds.length,
      receipts: receipts?.length ?? 0,
      transactions: txIds.length,
      componentsToAdjust: deltas.size,
    });
    // Show first few deltas
    let shown = 0;
    for (const [cid, qty] of deltas.entries()) {
      console.log(`component_id=${cid} subtract=${qty}`);
      if (++shown >= 10) break;
    }
    return;
  }

  // 7) Apply changes
  // 7a) Ensure inventory rows exist
  for (const cid of deltas.keys()) {
    const { data: inv, error: invErr } = await supabase.from('inventory').select('inventory_id, quantity_on_hand').eq('component_id', cid).maybeSingle();
    if (invErr) throw invErr;
    if (!inv) {
      const { error: insErr } = await supabase.from('inventory').insert({ component_id: cid, quantity_on_hand: 0 });
      if (insErr) throw insErr;
    }
  }

  // 7b) Reverse inventory quantities
  for (const [cid, qty] of deltas.entries()) {
    const { data: inv, error: invErr } = await supabase.from('inventory').select('inventory_id, quantity_on_hand').eq('component_id', cid).single();
    if (invErr) throw invErr;
    const current = inv.quantity_on_hand ?? 0;
    const next = clampZero ? Math.max(0, current - qty) : current - qty;
    const { error: updErr } = await supabase.from('inventory').update({ quantity_on_hand: next }).eq('inventory_id', inv.inventory_id);
    if (updErr) throw updErr;
  }

  // 7c) Delete receipts
  if (receipts && receipts.length) {
    const receiptIds = receipts.map((r) => r.receipt_id);
    // Delete in chunks
    for (let i = 0; i < receiptIds.length; i += 1000) {
      const chunk = receiptIds.slice(i, i + 1000);
      const { error: delErr } = await supabase.from('supplier_order_receipts').delete().in('receipt_id', chunk);
      if (delErr) throw delErr;
    }
  }

  // 7d) Delete inventory transactions created by those receipts
  if (txIds.length) {
    for (let i = 0; i < txIds.length; i += 1000) {
      const chunk = txIds.slice(i, i + 1000);
      const { error: delTxErr } = await supabase.from('inventory_transactions').delete().in('transaction_id', chunk);
      if (delTxErr) throw delTxErr;
    }
  }

  // 7e) Delete junction links
  if (soIds.length) {
    for (let i = 0; i < soIds.length; i += 1000) {
      const chunk = soIds.slice(i, i + 1000);
      const { error: delJErr } = await supabase.from('supplier_order_customer_orders').delete().in('supplier_order_id', chunk);
      if (delJErr) throw delJErr;
    }
  }

  // 7f) Delete supplier orders
  if (soIds.length) {
    for (let i = 0; i < soIds.length; i += 1000) {
      const chunk = soIds.slice(i, i + 1000);
      const { error: delSOErr } = await supabase.from('supplier_orders').delete().in('order_id', chunk);
      if (delSOErr) throw delSOErr;
    }
  }

  // 7g) Delete purchase orders
  for (let i = 0; i < targetPoIds.length; i += 1000) {
    const chunk = targetPoIds.slice(i, i + 1000);
    const { error: delPOErr } = await supabase.from('purchase_orders').delete().in('purchase_order_id', chunk);
    if (delPOErr) throw delPOErr;
  }

  console.log('Cleanup complete.');
}

main().catch((e) => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});

