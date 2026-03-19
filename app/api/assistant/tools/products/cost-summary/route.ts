import { NextRequest, NextResponse } from 'next/server';

import { getProductCostSummary } from '@/lib/assistant/costing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const routeClient = await getRouteClient(req);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const productRef = req.nextUrl.searchParams.get('product')?.trim();
  if (!productRef) {
    return NextResponse.json({ error: 'product query parameter is required' }, { status: 400 });
  }

  try {
    const result = await getProductCostSummary(routeClient.supabase, productRef, {
      origin: req.nextUrl.origin,
      cookieHeader: req.headers.get('cookie'),
      authorizationHeader: req.headers.get('authorization'),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[assistant] product cost summary route failed', error);
    return NextResponse.json({ error: 'Failed to load product cost summary' }, { status: 500 });
  }
}
