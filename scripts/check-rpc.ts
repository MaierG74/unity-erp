import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkRPC() {
    const { data, error } = await supabase.rpc('process_supplier_order_return', {
        p_supplier_order_id: 1, // Dummy ID
        p_quantity: 0,
        p_reason: 'test'
    });

    if (error && error.message.includes('function public.process_supplier_order_return') && error.message.includes('does not exist')) {
        console.log('RPC process_supplier_order_return does NOT exist.');
    } else {
        console.log('RPC process_supplier_order_return exists (or fails with logic error):', error?.message);
    }
}

checkRPC();
