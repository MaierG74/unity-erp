
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
    console.log('Fetching Purchase Order 49...');

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
        .eq('purchase_order_id', 49)
        .single();

    if (error) {
        console.error('Error fetching order:', error);
        return;
    }

    console.log('Order found:', purchaseOrder.q_number);
    console.log('Status:', purchaseOrder.status);

    if (!purchaseOrder.supplier_orders || purchaseOrder.supplier_orders.length === 0) {
        console.log('No supplier orders found.');
    } else {
        console.log(`Found ${purchaseOrder.supplier_orders.length} supplier orders.`);
        purchaseOrder.supplier_orders.forEach((so: any, index: number) => {
            console.log(`\nOrder #${index + 1} (ID: ${so.order_id}):`);
            console.log('  Quantity:', so.order_quantity);
            console.log('  Received:', so.total_received);

            if (!so.supplier_component) {
                console.error('  MISSING supplier_component!');
            } else {
                console.log('  Supplier Code:', so.supplier_component.supplier_code);

                if (!so.supplier_component.component) {
                    console.error('  MISSING component!');
                } else {
                    console.log('  Component:', so.supplier_component.component.internal_code);
                    console.log('  Component ID:', so.supplier_component.component.component_id);
                }

                if (!so.supplier_component.supplier) {
                    console.error('  MISSING supplier!');
                } else {
                    console.log('  Supplier:', so.supplier_component.supplier.name);
                }
            }
        });
    }
}

checkOrder();
