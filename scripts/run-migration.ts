import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load env vars
dotenv.config({ path: '.env.local' });

const connectionString = process.env.DATABASE_URL?.replace(':6543', ':5432');

if (!connectionString) {
  console.error('DATABASE_URL is not defined');
  process.exit(1);
}

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Please provide a migration file path');
  process.exit(1);
}

async function runMigration() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Required for Supabase
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const sql = fs.readFileSync(migrationFile, 'utf8');
    console.log(`Running migration: ${migrationFile}`);

    await client.query(sql);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
