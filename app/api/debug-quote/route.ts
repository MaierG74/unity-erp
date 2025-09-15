import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchQuote } from '@/lib/db/quotes';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const quoteId = searchParams.get('id');

    if (!quoteId) {
      return NextResponse.json({ error: 'Quote ID is required' }, { status: 400 });
    }

    console.log('Testing database connection for quote:', quoteId);

    // Test 1: Check if we can connect to Supabase
    const { data: connectionTest, error: connectionError } = await supabase
      .from('quotes')
      .select('count')
      .limit(1);

    if (connectionError) {
      return NextResponse.json({ 
        error: 'Database connection failed', 
        details: connectionError 
      }, { status: 500 });
    }

    // Test 2: Check if the specific quote exists
    const { data: quoteExists, error: quoteError } = await supabase
      .from('quotes')
      .select('id, quote_number, status')
      .eq('id', quoteId)
      .single();

    if (quoteError) {
      return NextResponse.json({ 
        error: 'Quote fetch failed', 
        details: quoteError,
        quoteId 
      }, { status: 404 });
    }

    // Test 3: Try the fixed fetchQuote function
    try {
      const fullQuote = await fetchQuote(quoteId);
      
      return NextResponse.json({
        success: true,
        connectionTest: !!connectionTest,
        quoteExists,
        fullQuote,
        message: 'All tests passed - fetchQuote working!'
      });
    } catch (fetchError: any) {
      return NextResponse.json({ 
        error: 'fetchQuote function failed', 
        details: fetchError.message,
        basicQuote: quoteExists 
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Debug API error:', error);
    return NextResponse.json({ 
      error: 'Unexpected error', 
      details: error.message 
    }, { status: 500 });
  }
}
