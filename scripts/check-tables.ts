import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: './.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

// Initialize Supabase client with service role key for admin privileges
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// List of potential tables to check
const tablesToCheck = [
  'components',
  'suppliers',
  'supplier_components',
  'suppliercomponents',
  'supplier_orders',
  'supplier_order_statuses',
  'supplier_order_receipts',
  'inventory_transactions',
  'transaction_types'
];

async function checkTables() {
  console.log('Checking tables in the database...');
  
  const results: Record<string, boolean> = {};
  
  for (const table of tablesToCheck) {
    const { data, error } = await supabase
      .from(table)
      .select('count(*)', { count: 'exact', head: true });
    
    if (error) {
      console.log(`Table '${table}': Does not exist (${error.code})`);
      results[table] = false;
    } else {
      console.log(`Table '${table}': Exists with ${data} records`);
      results[table] = true;
    }
  }
  
  console.log('\nSummary:');
  console.log('Tables that exist:');
  const existingTables = Object.entries(results)
    .filter(([_, exists]) => exists)
    .map(([table]) => table);
  
  console.log(existingTables.length > 0 ? existingTables.join(', ') : 'None');
  
  console.log('\nTables that do not exist:');
  const missingTables = Object.entries(results)
    .filter(([_, exists]) => !exists)
    .map(([table]) => table);
  
  console.log(missingTables.length > 0 ? missingTables.join(', ') : 'None');
}

// Run the check
checkTables()
  .then(() => {
    console.log('\nCheck complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Check failed:', err);
    process.exit(1);
  }); 