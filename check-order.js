// Script to check for Apollo products in order #89
console.log('Starting order check script');

const { createClient } = require('@supabase/supabase-js');

// Import environment variables - ensure these are set in your environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Supabase environment variables not set!');
  console.log('Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkOrder() {
  try {
    console.log('Checking order #89...');
    
    // Check order details
    const { data: orderDetails, error: orderError } = await supabase
      .from('order_details')
      .select(`
        order_detail_id,
        product_id,
        quantity,
        product:products(
          product_id,
          name,
          description
        )
      `)
      .eq('order_id', 89);
    
    if (orderError) {
      console.error('Error fetching order details:', orderError);
      return;
    }
    
    if (!orderDetails || orderDetails.length === 0) {
      console.log('No order details found for order #89');
      return;
    }
    
    console.log(`Found ${orderDetails.length} order details for order #89`);
    
    // Check for Apollo chairs
    const apolloItems = orderDetails.filter(item => 
      item.product?.name?.toLowerCase().includes('apollo')
    );
    
    if (apolloItems.length === 0) {
      console.log('No Apollo products found in order #89');
    } else {
      console.log(`Found ${apolloItems.length} Apollo products in order #89:`);
      apolloItems.forEach(item => {
        console.log(`- ${item.quantity}x ${item.product.name}`);
      });
    }
    
    // Check if there are any products with BOM
    console.log('\nChecking for products with bill of materials...');
    
    // For each product, check if there's a BOM
    for (const detail of orderDetails) {
      const { data: bomData, error: bomError } = await supabase
        .from('billofmaterials')
        .select('count(*)')
        .eq('product_id', detail.product_id);
      
      if (bomError) {
        console.error(`Error checking BOM for product ${detail.product_id}:`, bomError);
        continue;
      }
      
      const bomCount = bomData?.[0]?.count || 0;
      
      console.log(`Product: ${detail.product.name} (ID: ${detail.product_id}) - BOM items: ${bomCount}`);
    }
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the check
checkOrder()
  .then(() => console.log('Check completed'))
  .catch(err => console.error('Script error:', err)); 