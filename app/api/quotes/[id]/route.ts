import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id;
    console.log('Fetching quote via API with ID:', quoteId);

    // Use admin client to bypass RLS
    const { data: quote, error: quoteError } = await supabaseAdmin
      .from('quotes')
      .select('*, customer:customers(id, name, email, telephone)')
      .eq('id', quoteId)
      .single();

    if (quoteError) {
      console.error('Quote fetch error:', quoteError);
      return NextResponse.json(
        { error: 'Quote not found', details: quoteError.message },
        { status: 404 }
      );
    }

    // Fetch related items
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('quote_items')
      .select('*, quote_item_clusters(*, quote_cluster_lines(*))')
      .eq('quote_id', quoteId);

    // Fetch related attachments
    const { data: attachments, error: attachmentsError } = await supabaseAdmin
      .from('quote_attachments')
      .select('*')
      .eq('quote_id', quoteId);

    // Log any errors but don't fail the whole operation
    if (itemsError) console.warn('Failed to fetch quote items:', itemsError);
    if (attachmentsError) console.warn('Failed to fetch quote attachments:', attachmentsError);

    const result = {
      ...quote,
      items: items || [],
      attachments: attachments || [],
    };

    console.log('Quote fetched successfully via API:', result);
    return NextResponse.json(result);

  } catch (error) {
    console.error('API error fetching quote:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE /api/quotes/[id] - deletes a quote and cascades related rows
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const quoteId = params.id;

    const { error } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('id', quoteId);

    if (error) {
      console.error('Quote delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete quote', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API error deleting quote:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
