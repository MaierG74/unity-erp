import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    // Check supplier_order_statuses
    const { data, error } = await supabase
        .from('supplier_order_statuses')
        .select('*');

    if (error) {
        console.error('Error fetching supplier_order_statuses:', error);
    } else {
        console.log('Supplier Order Statuses:', data);
    }

    // List all tables (if possible via RPC or just guessing)
    // Actually, let's just check if 'statuses' exists
    const { data: statusesData, error: statusesError } = await supabase
        .from('statuses')
        .select('*');

    if (!statusesError) {
        console.log('Statuses table:', statusesData);
    }
}

main();
