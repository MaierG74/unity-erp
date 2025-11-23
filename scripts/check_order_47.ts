
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkOrder() {
    console.log('Fetching Purchase Order 47...');

    // First, just check if the PO exists at all
    const { data: simplePO, error: simpleError } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('purchase_order_id', 47)
        .maybeSingle();

    if (simpleError) {
        console.error('Error fetching simple PO:', simpleError);
        return;
    }

    if (!simplePO) {
        console.error('Purchase Order 47 does NOT exist in the purchase_orders table.');
        return;
    }

    console.log('PO 47 exists. Status ID:', simplePO.status_id);

    // Now try the complex query used in the app
    const { data: purchaseOrder, error } = await supabase
        .from('purchase_orders')
        .select(`
      *,
      status:supplier_order_statuses!inner(
        status_id,
        status_name
      ),
      supplier_orders(
        order_id,
        order_quantity,
        total_received,
        supplier_component:suppliercomponents(
          supplier_code,
          price,
          component:components(
            component_id,
            internal_code,
            description
          ),
          supplier:suppliers(
            supplier_id,
            name,
            emails:supplier_emails(email, is_primary)
          )
        )
      )
    `)
        .eq('purchase_order_id', 47)
        .single();

    if (error) {
        console.error('Error fetching complex PO query:', error);
        // If inner join fails, it might be status
        if (error.message.includes('JSON object requested, multiple (or no) rows returned')) {
            console.log('Hint: This error often means a .single() failed or an !inner join filtered out the row.');
        }
        return;
    }

    console.log('Complex query successful!');
    console.log('Order:', purchaseOrder.q_number);
}

checkOrder();
