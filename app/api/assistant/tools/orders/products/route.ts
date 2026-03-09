import { NextRequest, NextResponse } from 'next/server';

import { getOrderProductsSummary } from '@/lib/assistant/operational';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const routeClient = await getRouteClient(req);
  if ('error' in routeClient) {
    return NextResponse.json({ error: routeClient.error }, { status: routeClient.status ?? 401 });
  }

  const orderRef = req.nextUrl.searchParams.get('order')?.trim();
  if (!orderRef) {
    return NextResponse.json({ error: 'order query parameter is required' }, { status: 400 });
  }

  try {
    const result = await getOrderProductsSummary(routeClient.supabase, orderRef);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[assistant] order products route failed', error);
    return NextResponse.json({ error: 'Failed to load order products summary' }, { status: 500 });
  }
}
