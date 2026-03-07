import { NextRequest, NextResponse } from 'next/server';

import { getLowStockSummary } from '@/lib/assistant/operational';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getLowStockSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][inventory][low-stock] Failed to load summary', error);
    return NextResponse.json({ error: 'Failed to load low-stock summary' }, { status: 500 });
  }
}
