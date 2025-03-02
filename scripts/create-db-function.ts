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

async function createDbFunction() {
  console.log('Creating database function for updating order quantities...');
  
  // SQL to create the function
  const sql = `
CREATE OR REPLACE FUNCTION update_order_received_quantity(order_id_param INTEGER)
RETURNS VOID AS $$
BEGIN
  -- Update the total_received column with the sum of all receipt quantities
  UPDATE supplier_orders
  SET total_received = (
    SELECT COALESCE(SUM(quantity_received), 0)
    FROM supplier_order_receipts
    WHERE order_id = order_id_param
  )
  WHERE order_id = order_id_param;
  
  -- Update the status to "In Progress" if partially received
  UPDATE supplier_orders
  SET status_id = (SELECT status_id FROM supplier_order_statuses WHERE status_name = 'In Progress')
  WHERE order_id = order_id_param
    AND total_received > 0
    AND total_received < order_quantity
    AND status_id = (SELECT status_id FROM supplier_order_statuses WHERE status_name = 'Open');
  
  -- Update the status to "Completed" if fully received
  UPDATE supplier_orders
  SET status_id = (SELECT status_id FROM supplier_order_statuses WHERE status_name = 'Completed')
  WHERE order_id = order_id_param
    AND total_received >= order_quantity
    AND status_id IN (
      SELECT status_id FROM supplier_order_statuses WHERE status_name IN ('Open', 'In Progress')
    );
END;
$$ LANGUAGE plpgsql;
  `;
  
  try {
    // Execute SQL directly
    const { error } = await supabase.rpc('exec_sql', { sql });
    
    if (error) {
      console.error('Error executing SQL:', error);
      
      // Try alternate approach using Supabase native query
      const res = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Prefer': 'params=single-object'
        },
        body: JSON.stringify({
          query: sql
        })
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error('Error with native query execution:', errorData);
        console.log('You may need to execute this SQL function manually through the Supabase SQL editor.');
      } else {
        console.log('Database function created successfully!');
      }
    } else {
      console.log('Database function created successfully!');
    }
  } catch (err) {
    console.error('Error creating database function:', err);
    console.log('Please execute this SQL function manually through the Supabase SQL editor.');
  }
}

// Run the creation
createDbFunction()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Function creation failed:', err);
    process.exit(1);
  }); 