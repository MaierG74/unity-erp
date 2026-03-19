import { NextRequest, NextResponse } from 'next/server';

import { getAssistantOrderPreview } from '@/lib/assistant/order-preview';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  const rawOrderId = req.nextUrl.searchParams.get('orderId')?.trim();
  const orderId = rawOrderId ? Number.parseInt(rawOrderId, 10) : Number.NaN;
  if (!Number.isFinite(orderId)) {
    return NextResponse.json({ error: 'orderId must be a valid number' }, { status: 400 });
  }

  try {
    const preview = await getAssistantOrderPreview(ctx.supabase, orderId);
    if (!preview) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json(preview);
  } catch (error) {
    console.error('[assistant][orders][preview] Failed to load order preview', error);
    return NextResponse.json({ error: 'Failed to load order preview' }, { status: 500 });
  }
}
