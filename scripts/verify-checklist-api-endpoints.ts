import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'greg@apexza.net';
const PASSWORD = 'password';

async function verifyApi() {
    console.log('Starting API verification...');

    // 1. Login to get token
    console.log('Logging in...');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase env vars');
        process.exit(1);
    }

    const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });

    if (!authRes.ok) {
        console.error('Login failed:', await authRes.text());
        process.exit(1);
    }

    const authData = await authRes.json();
    const token = authData.access_token;
    console.log('Got access token.');

    // 2. Create Todo
    console.log('Creating Todo via API...');
    const createRes = await fetch(`${BASE_URL}/api/todos`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: 'API Verification Todo',
            status: 'open',
            priority: 'medium',
        }),
    });

    if (!createRes.ok) {
        console.error('Create Todo failed:', await createRes.text());
        process.exit(1);
    }

    const createData = await createRes.json();
    const todoId = createData.todo.id;
    console.log(`Created Todo: ${todoId}`);

    // 3. Add Checklist Item
    console.log('Adding Checklist Item via API...');
    const addItemRes = await fetch(`${BASE_URL}/api/todos/${todoId}/checklist`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            title: 'API Checklist Item',
        }),
    });

    if (!addItemRes.ok) {
        console.error('Add Item failed:', await addItemRes.text());
        process.exit(1);
    }

    const addItemData = await addItemRes.json();
    console.log(`Added Item: ${addItemData.item.id}`);

    // 4. Fetch Detail to Verify Persistence
    console.log('Fetching Detail via API...');
    const fetchRes = await fetch(`${BASE_URL}/api/todos/${todoId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!fetchRes.ok) {
        console.error('Fetch Detail failed:', await fetchRes.text());
        process.exit(1);
    }

    const fetchData = await fetchRes.json();
    const checklist = fetchData.todo.checklist || [];

    console.log(`Fetched Checklist Items: ${checklist.length}`);
    if (checklist.length > 0) {
        console.log('First Item:', checklist[0]);
        if (checklist[0].title === 'API Checklist Item') {
            console.log('SUCCESS: Item persisted and retrieved correctly via API.');
        } else {
            console.error('FAILURE: Item title mismatch.');
        }
    } else {
        console.error('FAILURE: No checklist items returned.');
    }

    // Cleanup (optional, but good practice)
    // We don't have a DELETE endpoint for Todos exposed easily here, so we'll skip cleanup or do it via DB if needed.
}

verifyApi().catch(console.error);
