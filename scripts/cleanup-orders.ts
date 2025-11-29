import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Usage examples:
//  tsx scripts/cleanup-orders.ts --dry-run
//  tsx scripts/cleanup-orders.ts --after=2025-01-01
//  tsx scripts/cleanup-orders.ts --orderIds=23955,23950

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
  orderIds?: number[];
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { dryRun: false } as Args;
  for (const a of args) {
    if (a === '--dry-run' || a === '--dryrun') out.dryRun = true;
    else if (a.startsWith('--after=')) out.after = a.split('=')[1];
    else if (a.startsWith('--orderIds=')) out.orderIds = a.split('=')[1].split(',').map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  }
  return out;
}

async function main() {
  const { dryRun, after, orderIds } = parseArgs();
  console.log(`Cleanup Orders starting. dryRun=${dryRun} after=${after ?? 'n/a'} orderIds=${orderIds?.join(',') ?? 'all'}`);

  // 1) Load target orders
  let ordQuery = supabase.from('orders').select('order_id, customer_id, created_at').order('created_at', { ascending: false });
  if (after) ordQuery = ordQuery.gte('created_at', new Date(after).toISOString());
  if (orderIds && orderIds.length) ordQuery = ordQuery.in('order_id', orderIds);
  const { data: orders, error: ordErr } = await ordQuery;
  if (ordErr) throw ordErr;
  const targetOrderIds = (orders ?? []).map((o) => o.order_id);
  const targetCustomerIds = Array.from(new Set((orders ?? []).map((o) => o.customer_id))).filter(Boolean) as number[];
  if (!targetOrderIds.length) {
    console.log('No orders matched the criteria. Nothing to do.');
    return;
  }
  console.log(`Target orders: ${targetOrderIds.length}; Customers with storage folders: ${targetCustomerIds.length}`);

  // 2) Count details, attachments, junctions
  const { count: detailCount } = await supabase.from('order_details').select('*', { count: 'exact', head: true }).in('order_id', targetOrderIds);
  const { count: attachCount } = await supabase.from('order_attachments').select('*', { count: 'exact', head: true }).in('order_id', targetOrderIds);
  const { count: junctionCount } = await supabase.from('supplier_order_customer_orders').select('*', { count: 'exact', head: true }).in('order_id', targetOrderIds);
  
  // 2b) Load stock issuances linked to these orders
  const { data: issuances, error: issuErr } = await supabase
    .from('stock_issuances')
    .select('issuance_id, order_id, transaction_id, component_id, quantity_issued')
    .in('order_id', targetOrderIds);
  if (issuErr) throw issuErr;
  const issuanceTxIds = (issuances ?? []).map((i) => i.transaction_id).filter(Boolean) as number[];
  
  console.log(`Details=${detailCount ?? 0} Attachments=${attachCount ?? 0} Junctions=${junctionCount ?? 0} StockIssuances=${issuances?.length ?? 0}`);

  // 2c) Compute inventory reversal deltas for stock issuances
  // Stock issuances subtracted from inventory (negative transactions), so we need to ADD back
  const issuanceDeltas = new Map<number, number>(); // component_id -> qty to add back
  for (const iss of issuances ?? []) {
    if (!iss.component_id) continue;
    const qty = Number(iss.quantity_issued ?? 0);
    issuanceDeltas.set(iss.component_id, (issuanceDeltas.get(iss.component_id) ?? 0) + qty);
  }

  // 3) Storage listing (best-effort preview) on dry-run
  if (dryRun) {
    console.log('--- DRY RUN ---');
    console.log({
      orders: targetOrderIds.length,
      details: detailCount ?? 0,
      attachments: attachCount ?? 0,
      junctions: junctionCount ?? 0,
      stockIssuances: issuances?.length ?? 0,
      issuanceTransactions: issuanceTxIds.length,
      componentsToReverse: issuanceDeltas.size,
    });
    // Show first few issuance deltas
    let shown = 0;
    for (const [cid, qty] of issuanceDeltas.entries()) {
      console.log(`component_id=${cid} add_back=${qty}`);
      if (++shown >= 10) break;
    }
    for (const cid of targetCustomerIds.slice(0, 10)) {
      const prefix = `Orders/Customer/${cid}`;
      const { data: files, error: listErr } = await supabase.storage.from('qbutton').list(prefix, { limit: 100 });
      if (listErr) {
        console.warn(`List error for ${prefix}:`, listErr.message);
        continue;
      }
      console.log(`${prefix}: ${files?.length ?? 0} files (first 5 shown)`);
      files?.slice(0, 5).forEach((f) => console.log(` - ${f.name}`));
    }
    return;
  }

  // 4) Reverse inventory for stock issuances (add back issued quantities)
  for (const [cid, qty] of issuanceDeltas.entries()) {
    const { data: inv, error: invErr } = await supabase
      .from('inventory')
      .select('inventory_id, quantity_on_hand')
      .eq('component_id', cid)
      .maybeSingle();
    if (invErr) throw invErr;
    if (inv) {
      const current = inv.quantity_on_hand ?? 0;
      const next = current + qty; // Add back the issued quantity
      const { error: updErr } = await supabase
        .from('inventory')
        .update({ quantity_on_hand: next })
        .eq('inventory_id', inv.inventory_id);
      if (updErr) throw updErr;
    }
    // If no inventory row exists, the component was never stocked, skip
  }

  // 5) Delete stock issuances
  if (issuances && issuances.length) {
    const issuanceIds = issuances.map((i) => i.issuance_id);
    for (let i = 0; i < issuanceIds.length; i += 1000) {
      const chunk = issuanceIds.slice(i, i + 1000);
      const { error: delIssErr } = await supabase.from('stock_issuances').delete().in('issuance_id', chunk);
      if (delIssErr) throw delIssErr;
    }
  }

  // 6) Delete inventory transactions from stock issuances
  if (issuanceTxIds.length) {
    for (let i = 0; i < issuanceTxIds.length; i += 1000) {
      const chunk = issuanceTxIds.slice(i, i + 1000);
      const { error: delTxErr } = await supabase.from('inventory_transactions').delete().in('transaction_id', chunk);
      if (delTxErr) throw delTxErr;
    }
  }

  // 7) Delete junction links
  if ((junctionCount ?? 0) > 0) {
    for (let i = 0; i < targetOrderIds.length; i += 1000) {
      const chunk = targetOrderIds.slice(i, i + 1000);
      const { error: delJErr } = await supabase.from('supplier_order_customer_orders').delete().in('order_id', chunk);
      if (delJErr) throw delJErr;
    }
  }

  // 8) Delete attachment rows
  if ((attachCount ?? 0) > 0) {
    for (let i = 0; i < targetOrderIds.length; i += 1000) {
      const chunk = targetOrderIds.slice(i, i + 1000);
      const { error: delAErr } = await supabase.from('order_attachments').delete().in('order_id', chunk);
      if (delAErr) throw delAErr;
    }
  }

  // 9) Delete order details
  if ((detailCount ?? 0) > 0) {
    for (let i = 0; i < targetOrderIds.length; i += 1000) {
      const chunk = targetOrderIds.slice(i, i + 1000);
      const { error: delDErr } = await supabase.from('order_details').delete().in('order_id', chunk);
      if (delDErr) throw delDErr;
    }
  }

  // 10) Delete orders
  for (let i = 0; i < targetOrderIds.length; i += 1000) {
    const chunk = targetOrderIds.slice(i, i + 1000);
    const { error: delOErr } = await supabase.from('orders').delete().in('order_id', chunk);
    if (delOErr) throw delOErr;
  }

  // 11) Remove storage files under each customer folder (best effort)
  for (const cid of targetCustomerIds) {
    const prefix = `Orders/Customer/${cid}`;
    // List all files in the folder; paginate by fixed chunk
    let page = 0;
    const pageSize = 1000;
    while (true) {
      const { data: files, error: listErr } = await supabase.storage.from('qbutton').list(prefix, {
        limit: pageSize,
        offset: page * pageSize,
      });
      if (listErr) {
        console.warn(`List error for ${prefix}:`, listErr.message);
        break;
      }
      if (!files || files.length === 0) break;
      const paths = files.map((f) => `${prefix}/${f.name}`);
      const { error: rmErr } = await supabase.storage.from('qbutton').remove(paths);
      if (rmErr) {
        console.warn(`Remove error for ${prefix}:`, rmErr.message);
        break; // continue to next customer
      }
      page++;
    }
  }

  // 12) Refresh views if present
  try {
    await supabase.rpc('refresh_component_views');
  } catch (e) {
    // If function not present, ignore
  }

  console.log('Orders cleanup complete.');
}

main().catch((e) => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});

