import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getOrderBlockerSummary } from '@/lib/assistant/operational';
import { getRouteClient } from '@/lib/supabase-route';

const querySchema = z.object({
  order_ref: z.string().trim().min(1).max(200),
});

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const parsed = querySchema.safeParse({
    order_ref: req.nextUrl.searchParams.get('order_ref') ?? '',
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid "order_ref" query parameter is required.' }, { status: 400 });
  }

  try {
    const summary = await getOrderBlockerSummary(ctx.supabase, parsed.data.order_ref);

    if (summary.kind === 'not_found') {
      return NextResponse.json(summary, { status: 404 });
    }

    if (summary.kind === 'ambiguous') {
      return NextResponse.json(summary, { status: 409 });
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][orders][blockers] Failed to load summary', error);
    return NextResponse.json({ error: 'Failed to load order blocker summary' }, { status: 500 });
  }
}
