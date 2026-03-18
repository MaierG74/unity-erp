import { NextRequest, NextResponse } from 'next/server';

import {
  buildCutlistLineRefsFromLines,
  cloneCutlistLayoutWithLineRefs,
  cloneJsonValue,
} from '@/lib/cutlist/quoteSnapshotCopy';
import { supabaseAdmin } from '@/lib/supabase-admin';

type SourceQuoteItemCutlist = {
  options_hash?: string | null;
  layout_json: unknown;
  billing_overrides?: unknown;
};

type SourceQuoteClusterLine = {
  id: string;
  line_type: 'component' | 'manual' | 'labor' | 'overhead';
  component_id?: number | null;
  supplier_component_id?: number | null;
  description?: string | null;
  qty: number;
  unit_cost?: number | null;
  unit_price?: number | null;
  include_in_markup: boolean;
  labor_type?: string | null;
  hours?: number | null;
  rate?: number | null;
  sort_order: number;
  cutlist_slot?: string | null;
  overhead_element_id?: number | null;
  overhead_cost_type?: 'fixed' | 'percentage' | null;
  overhead_percentage_basis?: 'materials' | 'labor' | 'total' | null;
};

type SourceQuoteCluster = {
  id: string;
  name: string;
  notes?: string | null;
  position: number;
  markup_percent: number;
  quote_cluster_lines?: SourceQuoteClusterLine[] | null;
};

type SourceQuoteItem = {
  id: string;
  description: string;
  qty: number;
  unit_price: number;
  total: number;
  item_type?: 'priced' | 'heading' | 'note' | null;
  text_align?: 'left' | 'center' | 'right' | null;
  position?: number | null;
  bullet_points?: string | null;
  internal_notes?: string | null;
  selected_options?: Record<string, string> | null;
  quote_item_clusters?: SourceQuoteCluster[] | null;
  quote_item_cutlists?: SourceQuoteItemCutlist[] | null;
};

type SourceQuoteAttachment = {
  quote_item_id?: string | null;
  scope?: 'quote' | 'item' | null;
  file_url: string;
  mime_type: string;
  original_name?: string | null;
  display_in_quote?: boolean | null;
  crop_params?: unknown;
  annotations?: unknown;
  display_size?: string | null;
};

function parseCustomerId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

// POST /api/quotes/[id]/copy - copy a quote with all items, cutlists, clusters, lines, and attachments
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let newQuoteId: string | null = null;

  try {
    const { id: sourceQuoteId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const quoteNumber = typeof body?.quote_number === 'string' ? body.quote_number.trim() : '';
    const requestedCustomerId = parseCustomerId(body?.customer_id);

    if (!quoteNumber) {
      return NextResponse.json({ error: 'quote_number is required' }, { status: 400 });
    }

    if (Object.prototype.hasOwnProperty.call(body ?? {}, 'customer_id') && requestedCustomerId === null) {
      return NextResponse.json({ error: 'customer_id must be a positive integer' }, { status: 400 });
    }

    // Fetch all source data in parallel
    const [quoteResult, itemsResult, attachmentsResult] = await Promise.all([
      supabaseAdmin
        .from('quotes')
        .select('*')
        .eq('id', sourceQuoteId)
        .single(),
      supabaseAdmin
        .from('quote_items')
        .select('*, quote_item_clusters(*, quote_cluster_lines(*)), quote_item_cutlists(*)')
        .eq('quote_id', sourceQuoteId)
        .order('position', { ascending: true }),
      supabaseAdmin
        .from('quote_attachments')
        .select('*')
        .eq('quote_id', sourceQuoteId),
    ]);

    if (quoteResult.error || !quoteResult.data) {
      return NextResponse.json(
        { error: 'Source quote not found', details: quoteResult.error?.message },
        { status: 404 }
      );
    }

    if (itemsResult.error) {
      return NextResponse.json(
        { error: 'Failed to load source quote items', details: itemsResult.error.message },
        { status: 500 }
      );
    }

    if (attachmentsResult.error) {
      return NextResponse.json(
        { error: 'Failed to load source quote attachments', details: attachmentsResult.error.message },
        { status: 500 }
      );
    }

    const sourceQuote = quoteResult.data as Record<string, any>;
    const sourceItems = (itemsResult.data ?? []) as SourceQuoteItem[];
    const sourceAttachments = (attachmentsResult.data ?? []) as SourceQuoteAttachment[];
    const sourceCustomerId = parseCustomerId(sourceQuote.customer_id);

    if (sourceCustomerId === null) {
      return NextResponse.json(
        { error: 'Source quote is missing a valid customer_id' },
        { status: 500 }
      );
    }

    const targetCustomerId = requestedCustomerId ?? sourceCustomerId;
    const targetContactId =
      targetCustomerId === sourceCustomerId ? (sourceQuote.contact_id ?? null) : null;

    // Create the new quote
    const { data: newQuote, error: createQuoteError } = await supabaseAdmin
      .from('quotes')
      .insert([{
        quote_number: quoteNumber,
        customer_id: targetCustomerId,
        contact_id: targetContactId,
        status: 'draft',
        grand_total: sourceQuote.grand_total ?? 0,
        subtotal: sourceQuote.subtotal ?? 0,
        vat_rate: sourceQuote.vat_rate ?? null,
        vat_amount: sourceQuote.vat_amount ?? 0,
        notes: sourceQuote.notes ?? null,
        terms_conditions: sourceQuote.terms_conditions ?? null,
        valid_until: sourceQuote.valid_until ?? null,
      }])
      .select('*')
      .single();

    if (createQuoteError || !newQuote) {
      return NextResponse.json(
        { error: 'Failed to create copy', details: createQuoteError?.message },
        { status: 500 }
      );
    }

    newQuoteId = newQuote.id as string;

    const itemIdMap = new Map<string, string>();

    for (const sourceItem of sourceItems) {
      const { data: newItem, error: itemError } = await supabaseAdmin
        .from('quote_items')
        .insert([{
          quote_id: newQuoteId,
          description: sourceItem.description,
          qty: sourceItem.qty,
          unit_price: sourceItem.unit_price,
          total: sourceItem.total,
          item_type: sourceItem.item_type ?? 'priced',
          text_align: sourceItem.text_align ?? 'left',
          position: sourceItem.position ?? 0,
          bullet_points: sourceItem.bullet_points ?? null,
          internal_notes: sourceItem.internal_notes ?? null,
          selected_options: cloneJsonValue(sourceItem.selected_options ?? null),
        }])
        .select('id')
        .single();

      if (itemError || !newItem) {
        throw new Error(itemError?.message ?? `Failed to copy quote item ${sourceItem.id}`);
      }

      const newItemId = newItem.id as string;
      itemIdMap.set(sourceItem.id, newItemId);

      const copiedLinesForItem: Array<{ id: string; cutlist_slot?: string | null }> = [];
      const sourceClusters = [...(sourceItem.quote_item_clusters ?? [])].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );

      for (const sourceCluster of sourceClusters) {
        const { data: newCluster, error: clusterError } = await supabaseAdmin
          .from('quote_item_clusters')
          .insert([{
            quote_item_id: newItemId,
            name: sourceCluster.name,
            notes: sourceCluster.notes ?? null,
            position: sourceCluster.position ?? 0,
            markup_percent: sourceCluster.markup_percent ?? 0,
          }])
          .select('id')
          .single();

        if (clusterError || !newCluster) {
          throw new Error(clusterError?.message ?? `Failed to copy cluster ${sourceCluster.id}`);
        }

        const sourceLines = [...(sourceCluster.quote_cluster_lines ?? [])].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        );

        for (const sourceLine of sourceLines) {
          const { data: newLine, error: lineError } = await supabaseAdmin
            .from('quote_cluster_lines')
            .insert([{
              cluster_id: newCluster.id,
              line_type: sourceLine.line_type,
              component_id: sourceLine.component_id ?? null,
              supplier_component_id: sourceLine.supplier_component_id ?? null,
              description: sourceLine.description ?? null,
              qty: sourceLine.qty,
              unit_cost: sourceLine.unit_cost ?? null,
              unit_price: sourceLine.unit_price ?? null,
              include_in_markup: sourceLine.include_in_markup,
              labor_type: sourceLine.labor_type ?? null,
              hours: sourceLine.hours ?? null,
              rate: sourceLine.rate ?? null,
              sort_order: sourceLine.sort_order ?? 0,
              cutlist_slot: sourceLine.cutlist_slot ?? null,
              overhead_element_id: sourceLine.overhead_element_id ?? null,
              overhead_cost_type: sourceLine.overhead_cost_type ?? null,
              overhead_percentage_basis: sourceLine.overhead_percentage_basis ?? null,
            }])
            .select('id, cutlist_slot')
            .single();

          if (lineError || !newLine) {
            throw new Error(lineError?.message ?? `Failed to copy costing line ${sourceLine.id}`);
          }

          copiedLinesForItem.push({
            id: newLine.id as string,
            cutlist_slot: (newLine.cutlist_slot as string | null | undefined) ?? null,
          });
        }
      }

      const latestCutlist = Array.isArray(sourceItem.quote_item_cutlists)
        ? sourceItem.quote_item_cutlists[0] ?? null
        : null;

      if (latestCutlist) {
        const duplicatedLineRefs = buildCutlistLineRefsFromLines(copiedLinesForItem);
        const { error: cutlistError } = await supabaseAdmin.from('quote_item_cutlists').insert([{
          quote_item_id: newItemId,
          options_hash: latestCutlist.options_hash ?? null,
          layout_json: cloneCutlistLayoutWithLineRefs(latestCutlist.layout_json, duplicatedLineRefs),
          billing_overrides: cloneJsonValue(latestCutlist.billing_overrides ?? null),
        }]);

        if (cutlistError) {
          throw new Error(cutlistError.message);
        }
      }
    }

    // Batch insert all attachments at once
    if (sourceAttachments.length > 0) {
      const attachmentsToInsert = sourceAttachments.map((attachment: SourceQuoteAttachment) => ({
        quote_id: newQuoteId,
        quote_item_id: attachment.quote_item_id
          ? itemIdMap.get(attachment.quote_item_id) || null
          : null,
        scope: attachment.scope,
        file_url: attachment.file_url,
        mime_type: attachment.mime_type,
        original_name: attachment.original_name,
        display_in_quote: attachment.display_in_quote,
        crop_params: cloneJsonValue(attachment.crop_params ?? null),
        annotations: cloneJsonValue(attachment.annotations ?? null),
        display_size: attachment.display_size ?? null,
      }));

      const { error: attachmentsError } = await supabaseAdmin
        .from('quote_attachments')
        .insert(attachmentsToInsert);

      if (attachmentsError) {
        throw new Error(attachmentsError.message);
      }
    }

    return NextResponse.json({ quote: newQuote }, { status: 201 });

  } catch (error) {
    if (newQuoteId) {
      await supabaseAdmin
        .from('quotes')
        .delete()
        .eq('id', newQuoteId);
    }

    console.error('[COPY /quotes] API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
