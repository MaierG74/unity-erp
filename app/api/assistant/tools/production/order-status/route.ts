import { NextRequest, NextResponse } from 'next/server';

import { getOrderManufacturingSummary } from '@/lib/assistant/manufacturing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const orderRef = req.nextUrl.searchParams.get('order')?.trim();
  if (!orderRef) {
    return NextResponse.json({ error: 'An order query parameter is required.' }, { status: 400 });
  }

  try {
    const summary = await getOrderManufacturingSummary(ctx.supabase, orderRef);

    if (summary.kind === 'ambiguous') {
      return NextResponse.json(
        { error: `Multiple orders match "${orderRef}".`, candidates: summary.candidates },
        { status: 409 }
      );
    }

    if (summary.kind === 'not_found') {
      return NextResponse.json(
        { error: `No order matches "${orderRef}".` },
        { status: 404 }
      );
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][production][order-status] Failed to load order manufacturing summary', error);
    return NextResponse.json({ error: 'Failed to load order manufacturing summary' }, { status: 500 });
  }
}
