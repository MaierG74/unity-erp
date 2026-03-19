import { NextRequest, NextResponse } from 'next/server';

import { getProductOpenOrdersSummary } from '@/lib/assistant/operational';
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
    const result = await getProductOpenOrdersSummary(routeClient.supabase, productRef);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[assistant] product open orders route failed', error);
    return NextResponse.json({ error: 'Failed to load product open-order summary' }, { status: 500 });
  }
}
