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

async function checkSupplierComponents() {
  console.log('Checking supplier_components table...');

  // Check if table exists by querying its structure
  const { data: tableInfo, error: tableError } = await supabase.rpc('pg_table_def', {
    table_name: 'supplier_components'
  }).select('*').maybeSingle();

  if (tableError) {
    console.error('Error checking table information:', tableError);
    
    // Alternative: Try to query the table directly
    const { data, error } = await supabase
      .from('supplier_components')
      .select('*')
      .limit(1);

    if (error) {
      console.error('Error querying supplier_components table:', error);
      if (error.code === 'PGRST301') {
        console.error('The supplier_components table does not exist!');
      }
    } else {
      console.log('Supplier components table exists, sample data:', data);
    }
  } else {
    console.log('Table information:', tableInfo);
  }
}

// Run the check
checkSupplierComponents()
  .then(() => {
    console.log('Check complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Check failed:', err);
    process.exit(1);
  }); 