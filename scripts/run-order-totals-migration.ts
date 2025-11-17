import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });
dotenv.config();

async function runMigration() {
  // Get database connection string
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    console.error('Please set DATABASE_URL in your .env.local file.');
    console.error('Format: postgresql://postgres:[password]@[host]:[port]/postgres');
    process.exit(1);
  }

  const sql = readFileSync(join(process.cwd(), 'migrations/20250116_order_totals_triggers.sql'), 'utf-8');

  console.log('Running order totals migration...\n');

  const client = new Client({ connectionString: databaseUrl });
  
  try {
    await client.connect();
    await client.query(sql);
    console.log('✅ Migration completed successfully!');
    console.log('All order totals have been recalculated.');
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    if (error.position) {
      const pos = Number(error.position);
      const start = Math.max(0, pos - 120);
      const end = Math.min(sql.length, pos + 120);
      const snippet = sql.slice(start, end);
      console.error(`At position ${pos}. Context:`);
      console.error('---8<---');
      console.error(snippet);
      console.error('---8<---');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
