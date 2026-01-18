import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkTable() {
    const { data, error } = await supabase
        .from('supplier_order_returns')
        .select('*')
        .limit(1);

    if (error) {
        console.log('Table supplier_order_returns does not exist or error:', error.message);
    } else {
        console.log('Table supplier_order_returns exists.');
        console.log('Sample record:', data);

        // Check columns via a query to information_schema if possible, 
        // but rpc might be needed. Let's try to just select a non-existent column to see.
    }
}

checkTable();
