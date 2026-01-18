import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: './.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
    const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260118_create_supplier_returns.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Applying migration...');

    // Try using exec_sql RPC
    const { data, error } = await supabase.rpc('exec_sql', { sql });

    if (error) {
        console.error('Error applying migration via exec_sql:', error);

        // Fallback: This might not work if it's multiple statements, but let's try
        console.log('Attempting fallback...');
        try {
            const res = await fetch(`${supabaseUrl}/rest/v1/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'apikey': supabaseServiceKey,
                    'Prefer': 'params=single-object'
                },
                body: JSON.stringify({ query: sql })
            });
            if (res.ok) {
                console.log('Migration applied successfully via fallback!');
            } else {
                const errJson = await res.json();
                console.error('Fallback failed:', errJson);
            }
        } catch (e) {
            console.error('Fallback catch:', e);
        }
    } else {
        console.log('Migration applied successfully!');
    }
}

applyMigration();
