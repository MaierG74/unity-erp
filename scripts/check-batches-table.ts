import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkBatches() {
    const { data, error } = await supabase
        .from('supplier_return_batches')
        .select('*')
        .limit(1);

    if (error) {
        console.log('Table supplier_return_batches does not exist or error:', error.message);
    } else {
        console.log('Table supplier_return_batches exists.');
        console.log('Sample record:', data);
    }
}

checkBatches();
