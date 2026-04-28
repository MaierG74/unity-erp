import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

type OrganizationRow = {
  id: string;
  name: string | null;
};

type InventoryRow = {
  component_id: number;
};

type InventoryTransactionRow = {
  transaction_id: number;
  supplier_order_id: number | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Load them from .env.local before seeding WAC.'
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function parseArgs(argv: string[]) {
  const result: { orgId?: string } = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--org-id') {
      const value = argv[i + 1];
      if (!value) throw new Error('--org-id requires a UUID value');
      result.orgId = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function toCost(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function getOrganizations(orgId?: string): Promise<OrganizationRow[]> {
  let query = supabase.from('organizations').select('id, name').order('name');
  if (orgId) query = query.eq('id', orgId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load organizations: ${error.message}`);
  if (orgId && (!data || data.length === 0)) {
    throw new Error(`No organization found for --org-id ${orgId}`);
  }

  return (data ?? []) as OrganizationRow[];
}

async function getPurchaseTypeId() {
  const { data, error } = await supabase
    .from('transaction_types')
    .select('transaction_type_id')
    .eq('type_name', 'PURCHASE')
    .maybeSingle();

  if (error) throw new Error(`Failed to load PURCHASE transaction type: ${error.message}`);
  return data?.transaction_type_id == null ? null : Number(data.transaction_type_id);
}

async function getUnseededInventoryRows(orgId: string): Promise<InventoryRow[]> {
  const { data, error } = await supabase
    .from('inventory')
    .select('component_id')
    .eq('org_id', orgId)
    .is('average_cost', null)
    .order('component_id');

  if (error) throw new Error(`Failed to load inventory rows for org ${orgId}: ${error.message}`);
  return (data ?? []) as InventoryRow[];
}

async function getOrderIdForTransaction(transaction: InventoryTransactionRow) {
  if (transaction.supplier_order_id != null) return transaction.supplier_order_id;

  const { data, error } = await supabase
    .from('supplier_order_receipts')
    .select('order_id')
    .eq('transaction_id', transaction.transaction_id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve supplier receipt for transaction ${transaction.transaction_id}: ${error.message}`
    );
  }

  return data?.order_id == null ? null : Number(data.order_id);
}

async function getSupplierComponentPriceForOrder(orgId: string, orderId: number) {
  const { data: order, error: orderError } = await supabase
    .from('supplier_orders')
    .select('supplier_component_id')
    .eq('org_id', orgId)
    .eq('order_id', orderId)
    .maybeSingle();

  if (orderError) throw new Error(`Failed to load supplier order ${orderId}: ${orderError.message}`);
  if (!order?.supplier_component_id) return null;

  const { data: supplierComponent, error: supplierComponentError } = await supabase
    .from('suppliercomponents')
    .select('price')
    .eq('org_id', orgId)
    .eq('supplier_component_id', order.supplier_component_id)
    .maybeSingle();

  if (supplierComponentError) {
    throw new Error(
      `Failed to load supplier component ${order.supplier_component_id}: ${supplierComponentError.message}`
    );
  }

  return toCost(supplierComponent?.price);
}

async function getLastReceiptCost(orgId: string, componentId: number, purchaseTypeId: number | null) {
  if (purchaseTypeId == null) return null;

  const { data, error } = await supabase
    .from('inventory_transactions')
    .select('transaction_id, supplier_order_id')
    .eq('org_id', orgId)
    .eq('component_id', componentId)
    .eq('transaction_type_id', purchaseTypeId)
    .gt('quantity', 0)
    .order('transaction_date', { ascending: false })
    .order('transaction_id', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(
      `Failed to load receipt history for component ${componentId}: ${error.message}`
    );
  }

  for (const transaction of (data ?? []) as InventoryTransactionRow[]) {
    const orderId = await getOrderIdForTransaction(transaction);
    if (orderId == null) continue;

    const cost = await getSupplierComponentPriceForOrder(orgId, orderId);
    if (cost != null) return cost;
  }

  return null;
}

async function getListPriceFallback(orgId: string, componentId: number) {
  const { data, error } = await supabase
    .from('suppliercomponents')
    .select('price')
    .eq('org_id', orgId)
    .eq('component_id', componentId)
    .gt('price', 0);

  if (error) {
    throw new Error(
      `Failed to load supplier list prices for component ${componentId}: ${error.message}`
    );
  }

  const prices = (data ?? [])
    .map((row) => toCost(row.price))
    .filter((price): price is number => price != null);

  return prices.length === 0 ? null : Math.min(...prices);
}

async function updateAverageCostIfNull(orgId: string, componentId: number, averageCost: number) {
  const { data, error } = await supabase
    .from('inventory')
    .update({ average_cost: averageCost })
    .eq('org_id', orgId)
    .eq('component_id', componentId)
    .is('average_cost', null)
    .select('component_id');

  if (error) {
    throw new Error(`Failed to seed average_cost for component ${componentId}: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

async function seedOrganization(org: OrganizationRow, purchaseTypeId: number | null) {
  const rows = await getUnseededInventoryRows(org.id);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const receiptCost = await getLastReceiptCost(org.id, row.component_id, purchaseTypeId);
    const fallbackCost = receiptCost ?? (await getListPriceFallback(org.id, row.component_id));

    if (fallbackCost == null) {
      skipped += 1;
      continue;
    }

    if (await updateAverageCostIfNull(org.id, row.component_id, fallbackCost)) {
      updated += 1;
    }
  }

  return { scanned: rows.length, updated, skipped };
}

async function main() {
  const { orgId } = parseArgs(process.argv.slice(2));
  const organizations = await getOrganizations(orgId);
  const purchaseTypeId = await getPurchaseTypeId();

  let totalUpdated = 0;
  let totalScanned = 0;
  let totalSkipped = 0;

  for (const org of organizations) {
    const result = await seedOrganization(org, purchaseTypeId);
    totalUpdated += result.updated;
    totalScanned += result.scanned;
    totalSkipped += result.skipped;
    console.log(
      `[inventory-wac] ${org.name ?? org.id}: scanned ${result.scanned}, updated ${result.updated}, skipped ${result.skipped}`
    );
  }

  console.log(
    `[inventory-wac] complete: scanned ${totalScanned}, updated ${totalUpdated}, skipped ${totalSkipped}`
  );
}

main().catch((error) => {
  console.error('[inventory-wac] failed:', error);
  process.exitCode = 1;
});
