// Script to list all tables in the Supabase database
const { createClient } = require('@supabase/supabase-js');

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

async function listTables() {
  try {
    // Query to get all tables in the public schema
    const { data, error } = await supabase
      .from('pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');

    if (error) {
      console.error('Error fetching tables:', error);
      return;
    }

    console.log('Tables in the public schema:');
    if (data && data.length > 0) {
      data.forEach((table, index) => {
        console.log(`${index + 1}. ${table.tablename}`);
      });
    } else {
      console.log('No tables found in the public schema.');
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

// Execute the function
listTables(); 