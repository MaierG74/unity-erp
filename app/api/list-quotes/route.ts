import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Get all quotes to see what exists
    const { data: quotes, error } = await supabase
      .from('quotes')
      .select('id, quote_number, status, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ 
        error: 'Failed to fetch quotes', 
        details: error 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      quotes: quotes || [],
      count: quotes?.length || 0
    });

  } catch (error: any) {
    console.error('List quotes API error:', error);
    return NextResponse.json({ 
      error: 'Unexpected error', 
      details: error.message 
    }, { status: 500 });
  }
}
