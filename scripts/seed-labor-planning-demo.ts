import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing Supabase credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local.');
}

const supabase = createClient(supabaseUrl, serviceKey);

const ORDER_NUMBER = 'DEMO-LABOR-001';
const CUSTOMER_ID = 89;
const STATUS_ID = 27; // "New"
const PRODUCT_ID = 1; // Apollo Highback (already linked to bill of labour rows)
const JOB_ID = 1; // QC Chair

async function ensureBillOfLabor() {
  const { data: existing } = await supabase
    .from('billoflabour')
    .select('bol_id')
    .eq('product_id', PRODUCT_ID)
    .eq('job_id', JOB_ID)
    .maybeSingle();

  if (existing) return existing.bol_id;

  const { data, error } = await supabase
    .from('billoflabour')
    .insert({
      product_id: PRODUCT_ID,
      job_id: JOB_ID,
      time_required: 30,
      quantity: 1,
      time_unit: 'minutes',
      pay_type: 'hourly',
    })
    .select('bol_id')
    .maybeSingle();

  if (error || !data) throw error || new Error('Failed to insert billoflabour row');
  return data.bol_id;
}

async function ensureOrder() {
  const { data: existing } = await supabase
    .from('orders')
    .select('order_id')
    .eq('order_number', ORDER_NUMBER)
    .maybeSingle();

  if (existing) return existing.order_id;

  const now = new Date();
  const delivery = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from('orders')
    .insert({
      customer_id: CUSTOMER_ID,
      order_date: now.toISOString(),
      delivery_date: delivery.toISOString().slice(0, 10),
      status_id: STATUS_ID,
      order_number: ORDER_NUMBER,
      total_amount: 0,
    })
    .select('order_id')
    .maybeSingle();

  if (error || !data) throw error || new Error('Failed to insert order');
  return data.order_id;
}

async function ensureOrderDetail(orderId: number) {
  const { data: existing } = await supabase
    .from('order_details')
    .select('order_detail_id')
    .eq('order_id', orderId)
    .eq('product_id', PRODUCT_ID)
    .maybeSingle();

  if (existing) return existing.order_detail_id;

  const { data, error } = await supabase
    .from('order_details')
    .insert({
      order_id: orderId,
      product_id: PRODUCT_ID,
      quantity: 2,
      unit_price: 0,
    })
    .select('order_detail_id')
    .maybeSingle();

  if (error || !data) throw error || new Error('Failed to insert order detail');
  return data.order_detail_id;
}

async function main() {
  const bolId = await ensureBillOfLabor();
  const orderId = await ensureOrder();
  const detailId = await ensureOrderDetail(orderId);

  console.log(
    JSON.stringify(
      {
        bolId,
        orderId,
        detailId,
        orderNumber: ORDER_NUMBER,
        productId: PRODUCT_ID,
        jobId: JOB_ID,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('Seed failed', error);
  process.exit(1);
});
