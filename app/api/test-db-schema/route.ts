import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const results: any = {};

    // Test 1: Check if quotes table exists and get its structure
    const { data: quotesData, error: quotesError } = await supabase
      .from('quotes')
      .select('*')
      .limit(1);

    results.quotesTable = {
      exists: !quotesError,
      error: quotesError?.message,
      sampleData: quotesData?.[0] || null,
      count: quotesData?.length || 0
    };

    // Test 2: Check if quote_items table exists
    const { data: itemsData, error: itemsError } = await supabase
      .from('quote_items')
      .select('*')
      .limit(1);

    results.quoteItemsTable = {
      exists: !itemsError,
      error: itemsError?.message,
      sampleData: itemsData?.[0] || null,
      count: itemsData?.length || 0
    };

    // Test 3: Check if quote_attachments table exists
    const { data: attachmentsData, error: attachmentsError } = await supabase
      .from('quote_attachments')
      .select('*')
      .limit(1);

    results.quoteAttachmentsTable = {
      exists: !attachmentsError,
      error: attachmentsError?.message,
      sampleData: attachmentsData?.[0] || null,
      count: attachmentsData?.length || 0
    };

    // Test 4: Try to get the specific quote we're looking for
    const targetQuoteId = '23c78ff6-4c0b-4526-8fe0-e1e3c441a042';
    const { data: targetQuote, error: targetError } = await supabase
      .from('quotes')
      .select('*')
      .eq('id', targetQuoteId)
      .single();

    results.targetQuote = {
      found: !targetError,
      error: targetError?.message,
      data: targetQuote || null
    };

    return NextResponse.json({
      success: true,
      results,
      message: 'Database schema test completed'
    });

  } catch (error: any) {
    console.error('Schema test error:', error);
    return NextResponse.json({ 
      error: 'Schema test failed', 
      details: error.message 
    }, { status: 500 });
  }
}
