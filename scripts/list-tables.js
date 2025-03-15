// Script to list all tables in the Supabase database
const { createClient } = require('@supabase/supabase-js');

// Get Supabase credentials from environment variables
const supabaseUrl = 'https://ttlyfhkrsjjrzxiagzpb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0bHlmaGtyc2pqcnp4aWFnenBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTU1MjA0MzAsImV4cCI6MjAzMTA5NjQzMH0.Wd9JKE1Ub3MwRvBrRXJgJZPrEFLJoYk9J3Y0M1oPnQs';

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