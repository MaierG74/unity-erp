import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/quotes - list recent quotes
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('quotes')
      .select('id, quote_number, status, created_at, grand_total, customer_id, customer:customers(id, name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to list quotes', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ quotes: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Unexpected error', details: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}

// POST /api/quotes - create a new quote (server-side using service role to bypass RLS)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { quote_number, customer_id, status = 'draft' } = body ?? {};

    if (!quote_number || !customer_id) {
      return NextResponse.json(
        { error: 'quote_number and customer_id are required' },
        { status: 400 }
      );
    }

    const insert = {
      quote_number,
      customer_id,
      status,
    } as const;

    const { data: newQuote, error } = await supabaseAdmin
      .from('quotes')
      .insert([insert])
      .select('*')
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create quote', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ quote: newQuote }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Unexpected error', details: err?.message ?? 'Unknown error' },
      { status: 500 }
    );
  }
}
