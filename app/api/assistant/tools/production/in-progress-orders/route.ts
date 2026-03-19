import { NextRequest, NextResponse } from 'next/server';

import { getOrdersInProductionSummary } from '@/lib/assistant/manufacturing';
import { getRouteClient } from '@/lib/supabase-route';

export async function GET(req: NextRequest) {
  const ctx = await getRouteClient(req);
  if ('error' in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status ?? 401 });
  }

  try {
    const summary = await getOrdersInProductionSummary(ctx.supabase);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('[assistant][production][in-progress-orders] Failed to load in-production orders summary', error);
    return NextResponse.json({ error: 'Failed to load in-production orders summary' }, { status: 500 });
  }
}
