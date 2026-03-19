import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getItemDemandSummary } from '@/lib/assistant/demand';
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
    const result = await getItemDemandSummary(ctx.supabase, parsed.data.component_ref);

    if (result.kind === 'not_found') {
      return NextResponse.json(result, { status: 404 });
    }

    if (result.kind === 'ambiguous') {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[assistant][inventory][item-demand] Failed to load component demand', error);
    return NextResponse.json({ error: 'Failed to load component demand' }, { status: 500 });
  }
}
