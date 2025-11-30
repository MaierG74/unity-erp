import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSettings() {
    const { data, error } = await supabase
        .from('quote_company_settings')
        .select('*');

    if (error) {
        console.error('Error fetching settings:', error);
    } else {
        console.log('Settings found:', data);
    }
}

checkSettings();
