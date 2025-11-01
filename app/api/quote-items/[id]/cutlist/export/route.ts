import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { z } from 'zod';

const paramSchema = z.object({
  id: z.string().uuid('quote_item_id must be a UUID'),
});

const lineSchema = z
  .object({
    description: z.string().min(1),
    qty: z.number().finite().min(0),
    unit_cost: z.number().finite().nullable().optional(),
    component_id: z.number().int().positive().nullable().optional(),
  })
  .strict();

const refsSchema = z
  .object({
    primary: z.string().uuid().nullable().optional(),
    backer: z.string().uuid().nullable().optional(),
    band16: z.string().uuid().nullable().optional(),
    band32: z.string().uuid().nullable().optional(),
  })
  .partial();

const payloadSchema = z.object({
  existingLineRefs: refsSchema.optional(),
  lines: z.object({
    primary: lineSchema.nullable().optional(),
    backer: lineSchema.nullable().optional(),
    band16: lineSchema.nullable().optional(),
    band32: lineSchema.nullable().optional(),
  }),
});

type LineInput = z.infer<typeof lineSchema>;
type LineRefs = z.infer<typeof refsSchema>;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const parsedParams = paramSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Invalid quote item id', details: parsedParams.error.flatten() },
      { status: 400 }
    );
  }

  const quoteItemId = parsedParams.data.id;

  const body = await request.json();
  const parsedBody = payloadSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsedBody.error.flatten() },
      { status: 400 }
    );
  }

  const { existingLineRefs = {}, lines } = parsedBody.data;

  const { data: quoteItem, error: quoteItemError } = await supabaseAdmin
    .from('quote_items')
    .select('id, quote_id')
    .eq('id', quoteItemId)
    .maybeSingle();

  if (quoteItemError || !quoteItem) {
    return NextResponse.json({ error: 'Quote item not found or access denied' }, { status: 404 });
  }

  const { data: clusters, error: clustersError } = await supabaseAdmin
    .from('quote_item_clusters')
    .select('id')
    .eq('quote_item_id', quoteItemId)
    .order('position')
    .limit(1);

  if (clustersError) {
    console.error('Failed to fetch quote item clusters', clustersError);
    return NextResponse.json(
      { error: 'Failed to load costing cluster', details: clustersError.message },
      { status: 500 }
    );
  }

  let clusterId = clusters?.[0]?.id as string | undefined;

  if (!clusterId) {
    const { data: createdCluster, error: createError } = await supabaseAdmin
      .from('quote_item_clusters')
      .insert({ quote_item_id: quoteItemId, name: 'Costing Cluster', position: 0, markup_percent: 0 })
      .select('id')
      .single();

    if (createError || !createdCluster) {
      console.error('Failed to create costing cluster', createError);
      return NextResponse.json(
        { error: 'Failed to ensure costing cluster', details: createError?.message ?? 'Unknown error' },
        { status: 500 }
      );
    }

    clusterId = createdCluster.id as string;
  }

  const updatedRefs: Record<string, string | null> = { ...existingLineRefs };

  const managedSlots: Array<keyof typeof lines> = ['primary', 'backer', 'band16', 'band32'];

  async function upsertLine(refKey: keyof typeof lines, line: LineInput | null | undefined) {
    const existingId = existingLineRefs?.[refKey] ?? null;

    if (!line || !(line.qty > 0)) {
      if (existingId) {
        const { error: deleteError } = await supabaseAdmin
          .from('quote_cluster_lines')
          .delete()
          .eq('id', existingId);

        if (deleteError) {
          console.warn('Failed to delete costing line', { refKey, existingId, deleteError });
        }
      }

      updatedRefs[refKey] = null;
      return;
    }

    const normalizedQty = Number(line.qty.toFixed(3));
    const normalizedCost = line.unit_cost == null || Number.isNaN(line.unit_cost) ? null : Number(line.unit_cost);
    const isComponent = Boolean(line.component_id);
    const payload = {
      description: line.description,
      qty: normalizedQty,
      unit_cost: normalizedCost,
      component_id: line.component_id ?? null,
      include_in_markup: true,
      sort_order: 0,
      line_type: isComponent ? 'component' : 'manual',
      cutlist_slot: refKey,
    } as const;

    if (existingId) {
      const { data: updatedLine, error: updateError } = await supabaseAdmin
        .from('quote_cluster_lines')
        .update(payload)
        .eq('id', existingId)
        .select('id')
        .maybeSingle();

      if (!updateError && updatedLine) {
        updatedRefs[refKey] = updatedLine.id as string;
        return;
      }

      console.warn('Failed to update existing costing line; creating new one instead', {
        refKey,
        existingId,
        updateError,
      });
    }

    const { data: createdLine, error: createLineError } = await supabaseAdmin
      .from('quote_cluster_lines')
      .insert({ ...payload, cluster_id: clusterId })
      .select('id')
      .single();

    if (createLineError || !createdLine) {
      console.error('Failed to create costing line', { refKey, createLineError });
      throw new Error(createLineError?.message ?? 'Failed to create costing line');
    }

    updatedRefs[refKey] = createdLine.id as string;
  }

  try {
    await upsertLine('primary', lines.primary ?? null);
    await upsertLine('backer', lines.backer ?? null);
    await upsertLine('band16', lines.band16 ?? null);
    await upsertLine('band32', lines.band32 ?? null);
  } catch (err) {
    console.error('Failed to upsert costing lines', err);
    return NextResponse.json(
      { error: 'Failed to update costing lines', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({ lineRefs: updatedRefs });
}
