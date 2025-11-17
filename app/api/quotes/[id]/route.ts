import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quoteId } = await context.params;
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
      .select('*, quote_item_clusters(*, quote_cluster_lines(*)), quote_item_cutlists(*)')
      .eq('quote_id', quoteId);

    // Fetch related attachments
    const { data: attachments, error: attachmentsError } = await supabaseAdmin
      .from('quote_attachments')
      .select('*')
      .eq('quote_id', quoteId);

    // Log any errors but don't fail the whole operation
    if (itemsError) console.warn('Failed to fetch quote items:', itemsError);
    if (attachmentsError) console.warn('Failed to fetch quote attachments:', attachmentsError);

    // Group attachments by scope and quote_item_id
    const allAttachments = attachments || [];
    const quoteAttachments = allAttachments.filter((att: any) => att.scope === 'quote');
    const itemAttachmentsMap = new Map<string, any[]>();

    allAttachments
      .filter((att: any) => att.scope === 'item' && att.quote_item_id)
      .forEach((att: any) => {
        if (!itemAttachmentsMap.has(att.quote_item_id)) {
          itemAttachmentsMap.set(att.quote_item_id, []);
        }
        itemAttachmentsMap.get(att.quote_item_id)!.push(att);
      });

    const result = {
      ...quote,
      items: Array.isArray(items)
        ? items.map((item: any) => {
            const cutlists = Array.isArray(item?.quote_item_cutlists) ? item.quote_item_cutlists : [];
            const [latestCutlist] = cutlists;
            const { quote_item_cutlists, ...rest } = item;
            return {
              ...rest,
              cutlist_snapshot: latestCutlist ?? null,
              attachments: itemAttachmentsMap.get(item.id) || [],
            };
          })
        : [],
      attachments: quoteAttachments,
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
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: quoteId } = await context.params;

    console.log(`[DELETE /quotes/${quoteId}] Starting deletion process`);

    // First, verify the quote exists
    const { data: quoteExists, error: checkErr } = await supabaseAdmin
      .from('quotes')
      .select('id, quote_number')
      .eq('id', quoteId)
      .single();

    if (checkErr || !quoteExists) {
      console.error(`[DELETE /quotes/${quoteId}] Quote not found`, checkErr);
      return NextResponse.json(
        { error: 'Quote not found', details: checkErr?.message },
        { status: 404 }
      );
    }

    console.log(`[DELETE /quotes/${quoteId}] Quote found: ${quoteExists.quote_number || quoteId}`);

    // Delete the quote (cascade will handle related rows: quote_items, quote_attachments, quote_email_log)
    // Note: orders.quote_id will be set to NULL due to ON DELETE SET NULL
    const { error } = await supabaseAdmin
      .from('quotes')
      .delete()
      .eq('id', quoteId);

    if (error) {
      console.error('[DELETE /quotes] Quote delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete quote', details: error.message },
        { status: 500 }
      );
    }

    console.log(`[DELETE /quotes/${quoteId}] Successfully deleted quote`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /quotes] API error deleting quote:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
