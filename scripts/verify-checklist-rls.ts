import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function verifyRLS() {
    console.log('Starting RLS check...');

    // 1. Sign in
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: 'greg@apexza.net',
        password: 'password',
    });

    if (authError || !authData.user) {
        console.error('Failed to sign in:', authError);
        return;
    }
    console.log(`Signed in as: ${authData.user.id}`);

    // 2. Create a test To-Do
    const { data: todo, error: createError } = await supabase
        .from('todo_items')
        .insert({
            title: 'RLS Test Todo',
            status: 'open',
            priority: 'medium',
            created_by: authData.user.id,
            assigned_to: authData.user.id
        })
        .select()
        .single();

    if (createError) {
        console.error('Failed to create todo:', createError);
        return;
    }
    console.log(`Created Todo: ${todo.id}`);

    // 3. Insert a checklist item
    const { data: item, error: insertError } = await supabase
        .from('todo_checklist_items')
        .insert({
            todo_id: todo.id,
            title: 'RLS Checklist Item',
            position: 0
        })
        .select()
        .single();

    if (insertError) {
        console.error('Failed to insert checklist item:', insertError);
        // Clean up
        await supabase.from('todo_items').delete().eq('id', todo.id);
        return;
    }
    console.log(`Created Checklist Item: ${item.id}`);

    // 4. Fetch it back using the same authenticated client
    const { data: fetchedItems, error: fetchError } = await supabase
        .from('todo_checklist_items')
        .select('*')
        .eq('todo_id', todo.id);

    if (fetchError) {
        console.error('Failed to fetch checklist items:', fetchError);
    } else if (fetchedItems.length === 0) {
        console.error('Fetched checklist items is EMPTY! RLS likely blocking SELECT.');
    } else {
        console.log(`Successfully fetched ${fetchedItems.length} items.`);
        console.log('Item:', fetchedItems[0]);
    }

    // 5. Clean up
    await supabase.from('todo_items').delete().eq('id', todo.id);
    console.log('Cleaned up test data.');
}

verifyRLS();
