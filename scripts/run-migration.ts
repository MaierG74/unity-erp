/**
 * Migration Runner Script
 * Usage: tsx scripts/run-migration.ts migrations/20251005_quote_email_log.sql
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { supabaseAdmin } from '@/lib/supabase-admin';

async function runMigration(migrationPath: string) {
  console.log(`Running migration: ${migrationPath}`);

  try {
    // Read the migration file
    const fullPath = resolve(process.cwd(), migrationPath);
    const sql = readFileSync(fullPath, 'utf-8');

    console.log('Migration SQL loaded, executing...\n');

    // Execute the SQL using Supabase admin client
    // Note: Supabase client doesn't directly support raw SQL execution
    // We need to use the REST API or execute via RPC

    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

    if (error) {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }

    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Error running migration:', error);
    process.exit(1);
  }
}

const migrationPath = process.argv[2];

if (!migrationPath) {
  console.error('Usage: tsx scripts/run-migration.ts <path-to-migration-file>');
  process.exit(1);
}

runMigration(migrationPath);
