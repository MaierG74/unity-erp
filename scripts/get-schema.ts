import { config } from 'dotenv';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function getSchema() {
  try {
    const { data, error } = await supabase
      .rpc('get_schema_info');

    if (error) throw error;

    console.log('Database Schema:\n');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error fetching schema:', error);
    console.log('\nAlternative: Please use the Supabase Dashboard to view your schema at:');
    console.log(supabaseUrl);
  }
}

getSchema(); 