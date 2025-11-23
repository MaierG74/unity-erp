import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

// Load environment variables
dotenv.config({ path: './.env.local' });

const migrationFile = 'supabase/migrations/20251119000000_get_component_affected_orders.sql';

async function applyMigration() {
    console.log(`Applying migration: ${migrationFile}...`);

    const sql = fs.readFileSync(migrationFile, 'utf8');

    // Try using pg first if DATABASE_URL is available
    if (process.env.DATABASE_URL) {
        console.log('Using pg client with DATABASE_URL...');
        const client = new Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false } // Often needed for Supabase
        });

        try {
            await client.connect();
            await client.query(sql);
            console.log('Migration applied successfully using pg!');
            await client.end();
            return;
        } catch (err) {
            console.error('Error using pg client:', err);
            await client.end();
            // Fallback to supabase-js
        }
    }

    // Fallback to supabase-js with service role key
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) and DATABASE_URL');
        process.exit(1);
    }

    console.log('Using Supabase client with service role key...');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try exec_sql RPC
    const { error } = await supabase.rpc('exec_sql', { sql });

    if (error) {
        console.error('Error executing SQL via RPC:', error);
        console.log('Please execute the SQL manually.');
        process.exit(1);
    } else {
        console.log('Migration applied successfully via RPC!');
    }
}

applyMigration().catch(console.error);
