const { createClient } = require('@supabase/supabase-js');

// Initialize the Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials. Check your environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOrderStatus() {
  try {
    // Fetch order #2 details
    const { data: order, error } = await supabase
      .from('supplier_orders')
      .select(`
        *,
        status:supplier_order_statuses(status_id, status_name)
      `)
      .eq('order_id', 2)
      .single();

    if (error) {
      console.error('Error fetching order:', error);
      return;
    }

    console.log('Order #2 Status:');
    console.log('-------------------');
    console.log(`Status ID: ${order.status_id}`);
    console.log(`Status Name: ${order.status.status_name}`);
    console.log(`Total Received: ${order.total_received}`);
    console.log(`Order Quantity: ${order.order_quantity}`);
    
    // Check receipts
    const { data: receipts, error: receiptsError } = await supabase
      .from('supplier_order_receipts')
      .select('*')
      .eq('order_id', 2);
    
    if (receiptsError) {
      console.error('Error fetching receipts:', receiptsError);
      return;
    }
    
    console.log('\nReceipts:');
    console.log('-------------------');
    receipts.forEach(receipt => {
      console.log(`Receipt ID: ${receipt.receipt_id}, Quantity: ${receipt.quantity_received}`);
    });
    
    // Check status IDs
    const { data: statuses, error: statusesError } = await supabase
      .from('supplier_order_statuses')
      .select('*');
    
    if (statusesError) {
      console.error('Error fetching statuses:', statusesError);
      return;
    }
    
    console.log('\nStatus IDs:');
    console.log('-------------------');
    statuses.forEach(status => {
      console.log(`${status.status_id}: ${status.status_name}`);
    });
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkOrderStatus(); 