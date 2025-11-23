import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: './.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyRpc() {
    console.log('Verifying get_component_affected_orders RPC...');

    // 1. Get a component ID
    const { data: components, error: compError } = await supabase
        .from('components')
        .select('component_id, internal_code')
        .limit(1);

    if (compError) {
        console.error('Error fetching components:', compError);
        return;
    }

    if (!components || components.length === 0) {
        console.log('No components found to test with.');
        return;
    }

    const component = components[0];
    console.log(`Testing with component: ${component.internal_code} (ID: ${component.component_id})`);

    // 2. Call the RPC
    const { data, error } = await supabase
        .rpc('get_component_affected_orders', { p_component_id: component.component_id });

    if (error) {
        console.error('RPC Call Failed:', error);
        console.log('\nPossible reasons:');
        console.log('- The SQL script was not executed successfully.');
        console.log('- The function name or signature does not match.');
    } else {
        console.log('RPC Call Successful!');
        console.log(`Returned ${data.length} affected orders.`);
        if (data.length > 0) {
            console.log('Sample data:', data[0]);
        }
    }
}

verifyRpc().catch(console.error);
