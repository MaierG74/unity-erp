import { NextRequest, NextResponse } from 'next/server';

import { getManufacturingSummary } from '@/lib/assistant/manufacturing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const productRef = req.nextUrl.searchParams.get('product')?.trim();
  if (!productRef) {
    return NextResponse.json({ error: 'A product query parameter is required.' }, { status: 400 });
  }

  try {
    const summary = await getManufacturingSummary(ctx.supabase, productRef);

    if (summary.kind === 'ambiguous') {
      return NextResponse.json(
        { error: `Multiple products match "${productRef}".`, candidates: summary.candidates },
        { status: 409 }
      );
    }

    if (summary.kind === 'not_found') {
      return NextResponse.json(
        { error: `No product matches "${productRef}".` },
        { status: 404 }
      );
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][production][product-status] Failed to load manufacturing summary', error);
    return NextResponse.json({ error: 'Failed to load manufacturing summary' }, { status: 500 });
  }
}
