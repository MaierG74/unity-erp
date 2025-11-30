import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verifyPersistence() {
    console.log('Starting persistence check...');

    // 1. Create a test user (or use existing one if possible, but service role bypasses auth for setup)
    // We'll use service role to create a todo, simulating a logged-in user action isn't strictly necessary 
    // if we just want to test the table mechanics, but to test RLS we'd need a user.
    // For now, let's just test if data STICKS in the table.

    // Get a valid user ID to be the creator
    const { data: users } = await supabase.from('profiles').select('id').limit(1);
    if (!users || users.length === 0) {
        console.error('No users found to create todo');
        return;
    }
    const userId = users[0].id;
    console.log(`Using user ID: ${userId}`);

    // 2. Create a test To-Do
    const { data: todo, error: createError } = await supabase
        .from('todo_items')
        .insert({
            title: 'Test Persistence Todo',
            created_by: userId,
            assigned_to: userId,
            status: 'open',
            priority: 'medium'
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
            title: 'Test Checklist Item',
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

    // 4. Fetch it back immediately
    const { data: fetchedItem, error: fetchError } = await supabase
        .from('todo_checklist_items')
        .select('*')
        .eq('id', item.id)
        .single();

    if (fetchError || !fetchedItem) {
        console.error('Failed to fetch checklist item immediately:', fetchError);
    } else {
        console.log('Successfully fetched item immediately.');
    }

    // 5. Clean up
    await supabase.from('todo_items').delete().eq('id', todo.id);
    console.log('Cleaned up test data.');
}

verifyPersistence();
