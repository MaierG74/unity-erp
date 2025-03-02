import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function GET() {
  try {
    // Get the current user session
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      return NextResponse.json({ 
        error: 'Session error', 
        details: sessionError.message 
      }, { status: 401 });
    }

    const session = sessionData.session;
    const isAuthenticated = !!session;

    // Try to get RLS policies (requires admin privileges, may not work)
    let rlsPolicies = null;
    try {
      const { data: policiesData, error: policiesError } = await supabase
        .from('pg_policies')
        .select('*');
      
      if (!policiesError) {
        rlsPolicies = policiesData;
      }
    } catch (e) {
      console.log('Could not fetch RLS policies directly');
    }

    // Test access to tables
    const tables = [
      'component_categories',
      'components',
      'inventory',
      'suppliers',
      'suppliercomponents',
      'unitsofmeasure',
      'inventory_transactions'
    ];

    const tableAccess: Record<string, {
      canRead: boolean;
      count?: number;
      error: string | null;
    }> = {};

    for (const table of tables) {
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('*', { count: 'exact' })
          .limit(1);

        tableAccess[table] = {
          canRead: !error,
          count: count || 0,
          error: error ? error.message : null
        };
      } catch (e: any) {
        tableAccess[table] = {
          canRead: false,
          error: e?.message || 'Unknown error'
        };
      }
    }

    // Try to insert a test record into component_categories
    const { data: insertData, error: insertError } = await supabase
      .from('component_categories')
      .insert({ categoryname: 'Test Category ' + new Date().toISOString() })
      .select();

    return NextResponse.json({
      isAuthenticated,
      user: session?.user || null,
      rlsPolicies,
      tableAccess,
      insertTest: {
        success: !insertError,
        data: insertData,
        error: insertError ? insertError.message : null
      }
    });
  } catch (error: any) {
    console.error('Error checking RLS:', error);
    return NextResponse.json({ error: 'Failed to check RLS', details: error?.message || 'Unknown error' }, { status: 500 });
  }
} 