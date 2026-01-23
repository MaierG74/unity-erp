import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// POST /api/quotes/[id]/copy - copy a quote with all its items, clusters, lines, and attachments
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sourceQuoteId } = await context.params;
    const body = await request.json();
    const { quote_number } = body ?? {};

    if (!quote_number) {
      return NextResponse.json(
        { error: 'quote_number is required' },
        { status: 400 }
      );
    }

    // Try using the database function first (much faster - single round trip)
    const { data: newQuoteId, error: rpcError } = await supabaseAdmin.rpc('copy_quote', {
      source_quote_id: sourceQuoteId,
      new_quote_number: quote_number,
    });

    if (!rpcError && newQuoteId) {
      // Fetch the created quote to return it
      const { data: newQuote } = await supabaseAdmin
        .from('quotes')
        .select('*')
        .eq('id', newQuoteId)
        .single();

      return NextResponse.json({ quote: newQuote }, { status: 201 });
    }

    // Fallback to batch insert approach if RPC function doesn't exist
    console.log('[COPY] RPC not available, using fallback:', rpcError?.message);

    // Fetch all source data in parallel
    const [quoteResult, itemsResult, attachmentsResult] = await Promise.all([
      supabaseAdmin
        .from('quotes')
        .select('*')
        .eq('id', sourceQuoteId)
        .single(),
      supabaseAdmin
        .from('quote_items')
        .select('*, quote_item_clusters(*, quote_cluster_lines(*))')
        .eq('quote_id', sourceQuoteId),
      supabaseAdmin
        .from('quote_attachments')
        .select('*')
        .eq('quote_id', sourceQuoteId),
    ]);

    const sourceQuote = quoteResult.data;
    const sourceItems = itemsResult.data || [];
    const sourceAttachments = attachmentsResult.data || [];

    if (quoteResult.error || !sourceQuote) {
      return NextResponse.json(
        { error: 'Source quote not found', details: quoteResult.error?.message },
        { status: 404 }
      );
    }

    // Create the new quote
    const { data: newQuote, error: createQuoteError } = await supabaseAdmin
      .from('quotes')
      .insert([{
        quote_number,
        customer_id: sourceQuote.customer_id,
        status: 'draft',
        grand_total: sourceQuote.grand_total || 0,
      }])
      .select('*')
      .single();

    if (createQuoteError || !newQuote) {
      return NextResponse.json(
        { error: 'Failed to create copy', details: createQuoteError?.message },
        { status: 500 }
      );
    }

    // Batch insert all items at once
    const itemIdMap = new Map<string, string>();

    if (sourceItems.length > 0) {
      const itemsToInsert = sourceItems.map((item: any) => ({
        quote_id: newQuote.id,
        description: item.description,
        qty: item.qty,
        unit_price: item.unit_price,
        total: item.total,
        bullet_points: item.bullet_points,
        internal_notes: item.internal_notes,
        selected_options: item.selected_options,
      }));

      const { data: newItems, error: itemsError } = await supabaseAdmin
        .from('quote_items')
        .insert(itemsToInsert)
        .select('id');

      if (!itemsError && newItems) {
        sourceItems.forEach((item: any, index: number) => {
          if (newItems[index]) {
            itemIdMap.set(item.id, newItems[index].id);
          }
        });
      }
    }

    // Batch insert all clusters at once
    const clusterIdMap = new Map<string, string>();
    const allClusters: { sourceCluster: any; newItemId: string }[] = [];

    for (const item of sourceItems) {
      const newItemId = itemIdMap.get(item.id);
      if (!newItemId) continue;

      const clusters = item.quote_item_clusters || [];
      for (const cluster of clusters) {
        allClusters.push({ sourceCluster: cluster, newItemId });
      }
    }

    if (allClusters.length > 0) {
      const clustersToInsert = allClusters.map(({ sourceCluster, newItemId }) => ({
        quote_item_id: newItemId,
        name: sourceCluster.name,
        notes: sourceCluster.notes,
        position: sourceCluster.position,
        markup_percent: sourceCluster.markup_percent,
      }));

      const { data: newClusters, error: clustersError } = await supabaseAdmin
        .from('quote_item_clusters')
        .insert(clustersToInsert)
        .select('id');

      if (!clustersError && newClusters) {
        allClusters.forEach(({ sourceCluster }, index) => {
          if (newClusters[index]) {
            clusterIdMap.set(sourceCluster.id, newClusters[index].id);
          }
        });
      }
    }

    // Batch insert all cluster lines at once
    const allLines: any[] = [];

    for (const { sourceCluster } of allClusters) {
      const newClusterId = clusterIdMap.get(sourceCluster.id);
      if (!newClusterId) continue;

      const lines = sourceCluster.quote_cluster_lines || [];
      for (const line of lines) {
        allLines.push({
          cluster_id: newClusterId,
          line_type: line.line_type,
          component_id: line.component_id,
          supplier_component_id: line.supplier_component_id,
          description: line.description,
          qty: line.qty,
          unit_cost: line.unit_cost,
          unit_price: line.unit_price,
          include_in_markup: line.include_in_markup,
          labor_type: line.labor_type,
          hours: line.hours,
          rate: line.rate,
          sort_order: line.sort_order,
          cutlist_slot: line.cutlist_slot,
        });
      }
    }

    if (allLines.length > 0) {
      await supabaseAdmin
        .from('quote_cluster_lines')
        .insert(allLines);
    }

    // Batch insert all attachments at once
    if (sourceAttachments.length > 0) {
      const attachmentsToInsert = sourceAttachments.map((attachment: any) => ({
        quote_id: newQuote.id,
        quote_item_id: attachment.quote_item_id
          ? itemIdMap.get(attachment.quote_item_id) || null
          : null,
        scope: attachment.scope,
        file_url: attachment.file_url,
        mime_type: attachment.mime_type,
        original_name: attachment.original_name,
        display_in_quote: attachment.display_in_quote,
      }));

      await supabaseAdmin
        .from('quote_attachments')
        .insert(attachmentsToInsert);
    }

    return NextResponse.json({ quote: newQuote }, { status: 201 });

  } catch (error) {
    console.error('[COPY /quotes] API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
