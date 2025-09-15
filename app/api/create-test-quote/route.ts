import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST() {
  try {
    // Create a test quote with a new UUID
    const testQuote = {
      quote_number: 'TEST-001',
      customer_id: 1,
      status: 'draft',
      grand_total: 1500.00,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newQuote, error: quoteError } = await supabase
      .from('quotes')
      .insert([testQuote])
      .select()
      .single();

    if (quoteError) {
      return NextResponse.json({ 
        error: 'Failed to create test quote', 
        details: quoteError 
      }, { status: 500 });
    }

    // Create a test quote item
    const testItem = {
      quote_id: newQuote.id,
      description: 'Test Product - Premium Widget',
      qty: 2,
      unit_price: 750.00,
      total: 1500.00
    };

    const { data: newItem, error: itemError } = await supabase
      .from('quote_items')
      .insert([testItem])
      .select()
      .single();

    if (itemError) {
      console.warn('Failed to create test item:', itemError);
    }

    return NextResponse.json({
      success: true,
      quote: newQuote,
      item: newItem,
      message: 'Test quote created successfully',
      testUrl: `/quotes/${newQuote.id}`
    });

  } catch (error: any) {
    console.error('Create test quote error:', error);
    return NextResponse.json({ 
      error: 'Unexpected error', 
      details: error.message 
    }, { status: 500 });
  }
}
