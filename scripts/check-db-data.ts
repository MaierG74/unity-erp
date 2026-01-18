import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkData() {
    const { data: statuses } = await supabase.from('supplier_order_statuses').select('*');
    console.log('Supplier Order Statuses:', statuses);

    const { data: types } = await supabase.from('transaction_types').select('*');
    console.log('Transaction Types:', types);
}

checkData();
