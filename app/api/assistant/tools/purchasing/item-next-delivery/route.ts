import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getItemNextDeliverySummary } from '@/lib/assistant/purchasing';
import { getRouteClient } from '@/lib/supabase-route';

const querySchema = z.object({
  component_ref: z.string().trim().min(2).max(200),
});

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const parsed = querySchema.safeParse({
    component_ref: req.nextUrl.searchParams.get('component_ref') ?? '',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid "component_ref" query parameter is required.' }, { status: 400 });
  }

  try {
    const result = await getItemNextDeliverySummary(ctx.supabase, parsed.data.component_ref);

    if (result.kind === 'not_found') {
      return NextResponse.json(result, { status: 404 });
    }

    if (result.kind === 'ambiguous') {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[assistant][purchasing][item-next-delivery] Failed to load ETA', error);
    return NextResponse.json({ error: 'Failed to load next delivery for item' }, { status: 500 });
  }
}
