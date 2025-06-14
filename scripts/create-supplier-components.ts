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

async function createSupplierComponentsTable() {
  console.log('Creating supplier_components table...');

  // Check if table exists by querying it directly
  const { error: checkError } = await supabase
    .from('supplier_components')
    .select('*')
    .limit(1);

  if (checkError) {
    if (checkError.code === '42P01') { // Relation does not exist
      console.log('Table doesn\'t exist, creating it...');
      
      // Create the table using SQL query
      const { error: createError } = await supabase.rpc('create_supplier_components_table');
      
      if (createError) {
        console.error('Failed to create table via RPC, you may need to run SQL directly:', createError);
        console.log(`
SQL script to create the table:

CREATE TABLE IF NOT EXISTS supplier_components (
  supplier_component_id SERIAL PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(supplier_id),
  component_id INTEGER NOT NULL REFERENCES components(component_id),
  cost DECIMAL(10,2),
  lead_time_days INTEGER,
  is_preferred BOOLEAN DEFAULT false,
  notes TEXT,
  UNIQUE(supplier_id, component_id)
);

GRANT ALL PRIVILEGES ON TABLE supplier_components TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE supplier_components_supplier_component_id_seq TO authenticated;
        `);
      } else {
        console.log('Table created successfully!');
      }
    } else {
      console.error('Error checking table:', checkError);
    }
  } else {
    console.log('Table already exists, no action needed.');
  }
}

// Run the creation
createSupplierComponentsTable()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Creation failed:', err);
    process.exit(1);
  }); 