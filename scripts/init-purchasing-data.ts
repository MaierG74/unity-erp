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

async function initPurchasingData() {
  console.log('Initializing purchasing module data...');

  // Initialize supplier order statuses
  const orderStatuses = [
    { status_name: 'Open' },
    { status_name: 'In Progress' },
    { status_name: 'Completed' },
    { status_name: 'Cancelled' }
  ];

  console.log('Creating supplier order statuses...');
  for (const status of orderStatuses) {
    // Check if status already exists
    const { data: existingStatus, error: checkError } = await supabase
      .from('supplier_order_statuses')
      .select('status_id')
      .eq('status_name', status.status_name)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error(`Error checking status ${status.status_name}:`, checkError);
      continue;
    }

    // If status doesn't exist, create it
    if (!existingStatus) {
      const { data, error } = await supabase
        .from('supplier_order_statuses')
        .insert(status)
        .select();

      if (error) {
        console.error(`Error creating status ${status.status_name}:`, error);
      } else {
        console.log(`Created status: ${status.status_name}`);
      }
    } else {
      console.log(`Status already exists: ${status.status_name}`);
    }
  }

  // Initialize transaction types
  const transactionTypes = [
    { type_name: 'PURCHASE' },
    { type_name: 'SALE' },
    { type_name: 'ADJUSTMENT' }
  ];

  console.log('Creating transaction types...');
  for (const type of transactionTypes) {
    // Check if type already exists
    const { data: existingType, error: checkError } = await supabase
      .from('transaction_types')
      .select('transaction_type_id')
      .eq('type_name', type.type_name)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error(`Error checking type ${type.type_name}:`, checkError);
      continue;
    }

    // If type doesn't exist, create it
    if (!existingType) {
      const { data, error } = await supabase
        .from('transaction_types')
        .insert(type)
        .select();

      if (error) {
        console.error(`Error creating type ${type.type_name}:`, error);
      } else {
        console.log(`Created type: ${type.type_name}`);
      }
    } else {
      console.log(`Type already exists: ${type.type_name}`);
    }
  }

  // Create update_order_received_quantity function
  console.log('Creating database function for updating order quantities...');
  const { error: functionError } = await supabase.rpc('create_update_order_received_quantity_function');

  if (functionError) {
    console.warn('Failed to create function via RPC. You may need to run the SQL script manually:', functionError);
    console.log(`
The SQL script for the function is:

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
    `);
  } else {
    console.log('Database function created or updated successfully.');
  }

  console.log('Initialization complete!');
}

// Run the initialization
initPurchasingData()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Initialization failed:', err);
    process.exit(1);
  }); 