#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
// Load env from .env, then also from .env.local if present
const dotenv = require('dotenv');
dotenv.config();
try {
  dotenv.config({ path: '.env.local' });
} catch {}

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: Supabase URL or service role key not found in environment variables.');
  console.error('Make sure you have a .env file with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

// Create Supabase client with service role key for admin access
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Get migration file path from command line arguments
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Error: No migration file specified.');
  console.error('Usage: node run-migrations.js <migration-file>');
  console.error('Example: node run-migrations.js db/migrations/bol_schema_update.sql');
  process.exit(1);
}

// Check if the file exists
const filePath = path.resolve(process.cwd(), migrationFile);
if (!fs.existsSync(filePath)) {
  console.error(`Error: Migration file not found: ${filePath}`);
  process.exit(1);
}

// Read the migration file
const sql = fs.readFileSync(filePath, 'utf8');

// Split the SQL into individual statements
// This is a simple implementation and might not work for all SQL files
const statements = sql
  .split(';')
  .map(statement => statement.trim())
  .filter(statement => statement.length > 0);

async function runMigration() {
  console.log(`Running migration: ${migrationFile}`);
  console.log(`Found ${statements.length} SQL statements to execute.`);
  
  try {
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`Executing statement ${i + 1}/${statements.length}...`);
      
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        console.error(`Error executing statement ${i + 1}:`, error);
        console.error('Statement:', statement);
        process.exit(1);
      }
    }
    
    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Error running migration:', error);
    process.exit(1);
  }
}

runMigration(); 
